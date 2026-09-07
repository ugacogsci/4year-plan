# Data source inventory

Every source needs an owner, access method, refresh schedule, provenance fields, and fallback behavior before it becomes a product dependency.

| Data                            | Preferred source                                        | Volatility      | Initial approach                                          |
| ------------------------------- | ------------------------------------------------------- | --------------- | --------------------------------------------------------- |
| Course descriptions and credits | Official UGA bulletin/catalog                           | Catalog cycle   | Versioned snapshots; diff each refresh                    |
| Program requirements            | Official bulletin plus advisor review                   | Catalog cycle   | Hand-model one program, then build import tooling         |
| Prerequisites                   | Official catalog                                        | Catalog cycle   | Parse into expression trees and retain source text        |
| Sections and meeting times      | Official registration data, subject to permitted access | Each term/daily | Investigate access before implementation                  |
| Capacity and waitlist           | Official registration data, subject to permitted access | Minutes         | Treat as optional live signal with timestamps             |
| Buildings and travel time       | Official campus map plus routing data                   | Low             | Canonical building IDs and conservative walking estimates |
| Instructor information          | Official directory and section listings                 | Each term       | Match by stable identifiers where available               |
| Instructor reviews              | Licensed/approved third-party source                    | Variable        | Optional enrichment; do not depend on scraping            |
| Outcomes and career surveys     | Official UGA outcomes data                              | Annual          | Aggregate context, never a promised individual outcome    |

The sample app deliberately uses strings such as `Demo snapshot` instead of fabricated current timestamps.
