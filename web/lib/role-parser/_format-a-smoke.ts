// Format A smoke test. Synthesize Longueuil-style XLSX (one row per
// (property, owner) pair), parse, verify groups and owners.
//
// Run: npx tsx lib/role-parser/_format-a-smoke.ts

import * as XLSX from "xlsx";
import { parseRoleFile } from "./index.ts";

const sheet = XLSX.utils.json_to_sheet([
  // Property #1: 2 owners (one person, one company), 2 rows
  {
    "Adresse": "100 rue Notre-Dame",
    "Ville": "LONGUEUIL",
    "Matricule": "AAAA-AA-AAAA-A-AAA-AAAA",
    "Nb logements": 12,
    "Année construction": 1985,
    "Évaluation totale": 2400000,
    "Nom propriétaire": "TREMBLAY, JEAN",
    "Téléphone propriétaire": "(450) 555-0001",
    "Adresse propriétaire": "999 rue Cherrier, Longueuil",
  },
  {
    "Adresse": "100 rue Notre-Dame",
    "Ville": "LONGUEUIL",
    "Matricule": "AAAA-AA-AAAA-A-AAA-AAAA",
    "Nb logements": 12,
    "Année construction": 1985,
    "Évaluation totale": 2400000,
    "Nom propriétaire": "Gestion Tremblay inc.",
    "Téléphone propriétaire": "514-555-0002",
    "Adresse propriétaire": "999 rue Cherrier, Longueuil",
  },
  // Property #2: single numbered company owner
  {
    "Adresse": "200 boul. Roland-Therrien",
    "Ville": "Longueuil",
    "Matricule": "BBBB-BB-BBBB-B-BBB-BBBB",
    "Nb logements": 6,
    "Nom propriétaire": "9999-9999 Québec inc.",
    "Téléphone propriétaire": "+1 514-555-0003",
  },
]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

const result = parseRoleFile(buf);
console.log("Format detected:", result.format);
console.log("Total rows scanned:", result.total_rows);
console.log("Grouped properties:", result.rows.length);
console.log();

let pass = true;
function expect(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label} — got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
  if (!ok) pass = false;
}

console.log("Format detection:");
expect(result.format, "role_a", "format detected as role_a");

console.log("\nRow grouping:");
expect(result.rows.length, 2, "two distinct properties");

console.log("\nProperty 1 (matricule AAAA-...):");
const p1 = result.rows.find(r => r.property.matricule === "AAAA-AA-AAAA-A-AAA-AAAA")!;
expect(p1?.property.address, "100 rue Notre-Dame", "address");
expect(p1?.property.num_units, 12, "num_units");
expect(p1?.owners.length, 2, "owner count");
expect(p1?.owners[0].kind, "person", "owner1.kind person");
expect(p1?.owners[0].full_name, "TREMBLAY, JEAN", "owner1.full_name");
expect(p1?.owners[0].phones, ["+14505550001"], "owner1.phones");
expect(p1?.owners[1].kind, "company", "owner2.kind company");
expect(p1?.owners[1].company_name, "Gestion Tremblay inc.", "owner2.company_name");

console.log("\nProperty 2 (matricule BBBB-...):");
const p2 = result.rows.find(r => r.property.matricule === "BBBB-BB-BBBB-B-BBB-BBBB")!;
expect(p2?.owners.length, 1, "owner count");
expect(p2?.owners[0].kind, "numbered_co", "numbered_co classification");
expect(p2?.owners[0].phones, ["+15145550003"], "phone parsed (with +1 prefix)");

console.log(pass ? "\n✅ ALL FORMAT A TESTS PASSED" : "\n❌ FORMAT A TESTS FAILED");
process.exit(pass ? 0 : 1);
