// Standalone smoke test for the rôle parser. Run with:
//   node web/lib/role-parser/_smoke-test.mjs
// (CommonJS-compatible: imports xlsx and runs the actual parser via tsx-style require)

import * as XLSX from "xlsx";
import { parseRoleFile } from "./index.ts";

// ─── Synthesize a Format B (Granby) workbook in memory ────────────────
const sheet = XLSX.utils.json_to_sheet([
  {
    "Adresse": "1234 rue Notre-Dame",
    "Ville": "GRANBY",
    "Matricule": "1234-56-7890-0-000-0000",
    "Logements": 8,
    "Année construction": 1985,
    "Évaluation totale": 1400000,
    "Propriétaire1_Nom": "TREMBLAY, JEAN",
    "Propriétaire1_Téléphone": "(450) 770-8489",
    "Propriétaire1_Adresse": "200-1350 rue Sherbrooke O Montréal (Québec) H3G1J1 Canada",
    "Propriétaire2_Nom": "Gestion CML inc.",
    "Propriétaire2_Téléphone": "450-555-0142",
    "Propriétaire2_Adresse": "999 boulevard Industriel Granby (Québec) J2G7H7",
  },
  {
    "Adresse": "567 rue des Érables",
    "Ville": "ST-HYACINTHE",
    "Matricule": "9876-54-3210-0-000-0000",
    "Logements": 4,
    "Propriétaire1_Nom": "9999-9999 Québec inc.",
    "Propriétaire1_Téléphone": "514.555.0143",
  },
  {
    // Row that should produce a matricule-shaped value AND a real phone —
    // the parser should NOT confuse the matricule for a phone.
    "Adresse": "888 avenue du Parc",
    "Ville": "Sherbrooke",
    "Matricule": "6429-88-8837-0-000-0000",
    "Propriétaire1_Nom": "GAGNON, MARIE",
    "Propriétaire1_Téléphone": "+1 (819) 555-7777",
  },
]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

const result = parseRoleFile(buf);

console.log("Format detected:", result.format);
console.log("Total rows:", result.total_rows);
console.log("Errors:", result.errors);
console.log();

let pass = true;
function expect(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label} — got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
  if (!ok) pass = false;
}

console.log("Row 1 (Granby, 2 owners):");
const r1 = result.rows[0];
expect(r1.property.address, "1234 rue Notre-Dame", "address");
expect(r1.property.city, "GRANBY", "city (raw — normalized at commit time)");
expect(r1.property.matricule, "1234-56-7890-0-000-0000", "matricule");
expect(r1.property.num_units, 8, "num_units");
expect(r1.owners.length, 2, "owners count");
expect(r1.owners[0].kind, "person", "owner1.kind");
expect(r1.owners[0].full_name, "TREMBLAY, JEAN", "owner1.full_name");
expect(r1.owners[0].phones, ["+14507708489"], "owner1.phones (E.164)");
expect(r1.owners[1].kind, "company", "owner2.kind");
expect(r1.owners[1].company_name, "Gestion CML inc.", "owner2.company_name");
expect(r1.owners[1].phones, ["+14505550142"], "owner2.phones");

console.log("\nRow 2 (St-Hyacinthe, numbered company):");
const r2 = result.rows[1];
expect(r2.owners[0].kind, "numbered_co", "owner.kind = numbered_co");
expect(r2.owners[0].phones, ["+15145550143"], "owner.phones (compact 514.555.0143)");

console.log("\nRow 3 (matricule-not-mistaken-for-phone test):");
const r3 = result.rows[2];
expect(r3.property.matricule, "6429-88-8837-0-000-0000", "matricule preserved");
expect(r3.owners[0].phones, ["+18195557777"], "owner.phones (real phone, not matricule)");

console.log(pass ? "\n✅ ALL SMOKE TESTS PASSED" : "\n❌ SMOKE TESTS FAILED");
process.exit(pass ? 0 : 1);
