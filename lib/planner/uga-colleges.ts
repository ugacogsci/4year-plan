export interface UgaCollege {
  id: string;
  name: string;
  aliases: string[];
  /** Whether the current Bulletin snapshot assigns a parsed bachelor's major here. */
  hasBaccalaureateProgram: boolean;
}

/** UGA's complete current roster, including non-baccalaureate and newly formed schools. */
export const UGA_COLLEGES: UgaCollege[] = [
  { id: 'ARTS', name: 'Franklin College of Arts and Sciences', aliases: ['Franklin', 'Arts and Sciences'], hasBaccalaureateProgram: true },
  { id: 'CAES', name: 'College of Agricultural and Environmental Sciences', aliases: ['CAES', 'Agricultural and Environmental Sciences'], hasBaccalaureateProgram: true },
  { id: 'LAW', name: 'School of Law', aliases: ['Law School'], hasBaccalaureateProgram: false },
  { id: 'PHAR', name: 'College of Pharmacy', aliases: ['Pharmacy'], hasBaccalaureateProgram: true },
  { id: 'FRS', name: 'Warnell School of Forestry and Natural Resources', aliases: ['Warnell', 'Forestry and Natural Resources'], hasBaccalaureateProgram: true },
  { id: 'EDCN', name: 'Mary Frances Early College of Education', aliases: ['Mary Frances Early', 'College of Education', 'Education'], hasBaccalaureateProgram: true },
  { id: 'GRAD', name: 'Graduate School', aliases: ['Graduate'], hasBaccalaureateProgram: false },
  { id: 'BUS', name: 'Terry College of Business', aliases: ['Terry', 'Business'], hasBaccalaureateProgram: true },
  { id: 'JOUR', name: 'Grady College of Journalism and Mass Communication', aliases: ['Grady', 'Journalism and Mass Communication'], hasBaccalaureateProgram: true },
  { id: 'FCS', name: 'College of Family and Consumer Sciences', aliases: ['FACS', 'Family and Consumer Sciences'], hasBaccalaureateProgram: true },
  { id: 'VET', name: 'College of Veterinary Medicine', aliases: ['Veterinary Medicine', 'Vet Med'], hasBaccalaureateProgram: true },
  { id: 'SSW', name: 'School of Social Work', aliases: ['Social Work'], hasBaccalaureateProgram: true },
  { id: 'ENV', name: 'College of Environment and Design', aliases: ['Environment and Design', 'CED'], hasBaccalaureateProgram: true },
  { id: 'SPIA', name: 'School of Public and International Affairs', aliases: ['SPIA', 'Public and International Affairs'], hasBaccalaureateProgram: true },
  { id: 'PBHL', name: 'College of Public Health', aliases: ['Public Health'], hasBaccalaureateProgram: true },
  { id: 'ECOL', name: 'Odum School of Ecology', aliases: ['Odum', 'Ecology'], hasBaccalaureateProgram: true },
  { id: 'FENGR', name: 'College of Engineering', aliases: ['Engineering'], hasBaccalaureateProgram: true },
  { id: 'HONORS', name: 'Morehead Honors College', aliases: ['Morehead', 'Honors College', 'Honors'], hasBaccalaureateProgram: false },
  { id: 'MED', name: 'School of Medicine', aliases: ['Medicine', 'Medical School'], hasBaccalaureateProgram: false },
  { id: 'NURS', name: 'School of Nursing', aliases: ['Nursing'], hasBaccalaureateProgram: false },
];

export const UGA_COLLEGE_BY_ID = new Map(UGA_COLLEGES.map((college) => [college.id, college]));

/** Bulletin program records still use two legacy/internal school codes. */
export function normalizeUgaCollegeId(id: string): string {
  if (id === 'EDHI') return 'EDCN';
  if (id === 'SOM') return 'MED';
  return id;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Find an explicitly named UGA college without treating generic words as a match. */
export function findUgaCollege(text: string): UgaCollege | null {
  const haystack = ` ${normalized(text)} `;
  const matches = UGA_COLLEGES.filter((college) =>
    [college.name, ...college.aliases]
      .filter((alias) => normalized(alias).length >= 5)
      .some((alias) => haystack.includes(` ${normalized(alias)} `)),
  );
  return matches.length === 1 ? matches[0] : null;
}
