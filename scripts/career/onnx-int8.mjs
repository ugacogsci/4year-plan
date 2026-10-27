/**
 * all-MiniLM-L6-v2 with its large weights stored as 8-bit numbers, so the
 * model fits one static file the browser can fetch (Cloudflare serves at most
 * 25 MiB per asset; the float model is 86 MiB).
 *
 * Weight-only: each large float matrix W becomes an int8 matrix Q and one
 * scale per row (a lookup table, Gather) or per column (a MatMul weight),
 * and two nodes at the head of the graph rebuild W = float(Q) * scale before
 * anything reads it. The arithmetic after that is the float model's own, so
 * nothing about the model changes but the rounding of its weights; the
 * check measures how close its sentence vectors stay to the float model's.
 * Cast and Mul exist in every opset the model could declare, so the opset
 * is left alone.
 *
 * ONNX files are protobuf. Rather than pull in a protobuf library, this walks
 * the wire format: every field of the model and its graph is copied byte for
 * byte except the initializers it replaces, and the new nodes go first in
 * the graph (repeated fields keep their wire order, and the nodes must be in
 * an order where every input exists before it is read).
 */
import { readFileSync, writeFileSync } from 'node:fs';

function varint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return [result, pos];
}

/** Top-level fields of one message: [{ field, wire, start, end, value: [from, to] | bigint }]. */
function fieldsOf(buf, from = 0, to = buf.length) {
  const out = [];
  let pos = from;
  while (pos < to) {
    const start = pos;
    let tag;
    [tag, pos] = varint(buf, pos);
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    let value;
    if (wire === 0) [value, pos] = varint(buf, pos);
    else if (wire === 1) { value = [pos, pos + 8]; pos += 8; }
    else if (wire === 5) { value = [pos, pos + 4]; pos += 4; }
    else if (wire === 2) {
      let len;
      [len, pos] = varint(buf, pos);
      value = [pos, pos + Number(len)];
      pos += Number(len);
    } else throw new Error(`wire type ${wire} at ${start}`);
    out.push({ field, wire, start, end: pos, value });
  }
  return out;
}

function encVarint(n) {
  let v = BigInt(n);
  const bytes = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    bytes.push(b);
  } while (v > 0n);
  return Buffer.from(bytes);
}
const tag = (field, wire) => encVarint((field << 3) | wire);
const lenField = (field, bytes) => Buffer.concat([tag(field, 2), encVarint(bytes.length), bytes]);
const strField = (field, s) => lenField(field, Buffer.from(s, 'utf8'));
const intField = (field, n) => Buffer.concat([tag(field, 0), encVarint(n)]);

function tensor({ name, dims, dataType, raw }) {
  return Buffer.concat([...dims.map((d) => intField(1, d)), intField(2, dataType), strField(8, name), lenField(9, raw)]);
}
function node({ op, inputs, outputs, name, attrs = [] }) {
  return Buffer.concat([...inputs.map((s) => strField(1, s)), ...outputs.map((s) => strField(2, s)), strField(3, name), strField(4, op), ...attrs]);
}
/** AttributeProto { name: 1, i: 3, type: 20 (INT = 2) }. */
const intAttr = (name, value) => lenField(5, Buffer.concat([strField(1, name), intField(3, value), intField(20, 2)]));

const str = (buf, [a, b]) => buf.subarray(a, b).toString('utf8');

/** Reads a TensorProto: dims, type, name and its float values (raw_data or float_data). */
function readTensor(buf, [from, to]) {
  const dims = [];
  let dataType = 0;
  let name = '';
  let raw = null;
  let floats = null;
  for (const f of fieldsOf(buf, from, to)) {
    if (f.field === 1 && f.wire === 0) dims.push(Number(f.value));
    else if (f.field === 1 && f.wire === 2) {
      let p = f.value[0];
      while (p < f.value[1]) { let v; [v, p] = varint(buf, p); dims.push(Number(v)); }
    } else if (f.field === 2) dataType = Number(f.value);
    else if (f.field === 8) name = str(buf, f.value);
    else if (f.field === 9) raw = buf.subarray(f.value[0], f.value[1]);
    else if (f.field === 4 && f.wire === 2) floats = buf.subarray(f.value[0], f.value[1]);
    else if (f.field === 14 || f.field === 13) throw new Error(`tensor ${name}: external data is not handled`);
  }
  const bytes = raw ?? floats;
  const values = bytes && dataType === 1 ? new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)) : null;
  return { dims, dataType, name, values };
}

function readNode(buf, [from, to]) {
  const inputs = [];
  let op = '';
  for (const f of fieldsOf(buf, from, to)) {
    if (f.field === 1) inputs.push(str(buf, f.value));
    else if (f.field === 4) op = str(buf, f.value);
  }
  return { op, inputs };
}

/**
 * Rewrites the model at `src` to `dest`. Returns what it did, for the log.
 * `minElements`: matrices smaller than this stay float (biases, layer norms).
 */
export function quantizeModel(src, dest, { minElements = 16384 } = {}) {
  const buf = readFileSync(src);
  const top = fieldsOf(buf);
  const graphField = top.find((f) => f.field === 7);
  if (!graphField) throw new Error('no graph');
  const graph = fieldsOf(buf, graphField.value[0], graphField.value[1]);
  const nodes = graph.filter((f) => f.field === 1).map((f) => readNode(buf, f.value));
  const graphInputs = new Set(graph.filter((f) => f.field === 11).map((f) => {
    const name = fieldsOf(buf, f.value[0], f.value[1]).find((g) => g.field === 1);
    return name ? str(buf, name.value) : '';
  }));
  const gatherTable = new Set(nodes.filter((n) => n.op === 'Gather').map((n) => n.inputs[0]));

  const head = [];
  const tail = [];
  const done = [];
  let floatBytes = 0;
  let intBytes = 0;
  const body = [];
  for (const f of graph) {
    if (f.field !== 5) { body.push(buf.subarray(f.start, f.end)); continue; }
    const t = readTensor(buf, f.value);
    const count = t.dims.reduce((a, b) => a * b, 1);
    if (t.dataType !== 1 || t.dims.length !== 2 || count < minElements || !t.values || graphInputs.has(t.name)) {
      body.push(buf.subarray(f.start, f.end));
      continue;
    }
    const [rows, cols] = t.dims;
    // A lookup table is read a row at a time; a MatMul weight produces one output per column.
    const byRow = gatherTable.has(t.name);
    const nScales = byRow ? rows : cols;
    const scales = new Float32Array(nScales);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = byRow ? r : c;
      const a = Math.abs(t.values[r * cols + c]);
      if (a > scales[k]) scales[k] = a;
    }
    for (let k = 0; k < nScales; k++) scales[k] = scales[k] > 0 ? scales[k] / 127 : 1;
    const q = new Int8Array(count);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const s = scales[byRow ? r : c];
      q[r * cols + c] = Math.max(-127, Math.min(127, Math.round(t.values[r * cols + c] / s)));
    }
    tail.push(lenField(5, tensor({ name: `${t.name}__q`, dims: [rows, cols], dataType: 3, raw: Buffer.from(q.buffer) })));
    tail.push(lenField(5, tensor({ name: `${t.name}__s`, dims: byRow ? [rows, 1] : [1, cols], dataType: 1, raw: Buffer.from(scales.buffer) })));
    head.push(lenField(1, node({ op: 'Cast', inputs: [`${t.name}__q`], outputs: [`${t.name}__f`], name: `${t.name}__cast`, attrs: [intAttr('to', 1)] })));
    head.push(lenField(1, node({ op: 'Mul', inputs: [`${t.name}__f`, `${t.name}__s`], outputs: [t.name], name: `${t.name}__scale` })));
    floatBytes += count * 4;
    intBytes += count + nScales * 4;
    done.push(`${t.name} [${rows}x${cols}] by ${byRow ? 'row' : 'column'}`);
  }
  const newGraph = Buffer.concat([...head, ...body, ...tail]);
  const out = [];
  for (const f of top) out.push(f.field === 7 ? lenField(7, newGraph) : buf.subarray(f.start, f.end));
  const bytes = Buffer.concat(out);
  writeFileSync(dest, bytes);
  return { matrices: done, floatBytes, intBytes, inBytes: buf.length, outBytes: bytes.length };
}
