#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
    }
  }
}

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function value(row, ...names) {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim() !== "") return row[name];
  }
  return null;
}

function text(row, ...names) {
  const v = value(row, ...names);
  return v == null ? null : String(v).trim();
}

function num(row, ...names) {
  const v = value(row, ...names);
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function cleanKey(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const workbookPath = arg("file");
const campaignName = arg("campaign", "Saint-Hyacinthe Round 1");
const city = arg("city", "Saint-Hyacinthe");
const mailedAt = arg("mailed-at");
const sheetName = arg("sheet", "Raw Cleaned");

if (!workbookPath) {
  console.error("Usage: node web/scripts/import-letter-campaign.mjs --file=/path/output.xlsx --campaign='Saint-Hyacinthe Round 1' --mailed-at=2026-05-14");
  process.exit(1);
}

loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), "web/.env.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRole) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const sb = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const workbook = XLSX.readFile(workbookPath, { cellDates: true });
const sheet = workbook.Sheets[sheetName] ?? workbook.Sheets[workbook.SheetNames[0]];
if (!sheet) {
  console.error(`Could not find sheet ${sheetName}.`);
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
const grouped = new Map();

for (const row of rows) {
  const matricule = text(row, "Matricule");
  if (!matricule) continue;
  const ownerName = text(row, "nom_propre") ?? text(row, "Propriétaire1_Nom") ?? "Unknown";
  const ownerKey = text(row, "CLE_PROPRIETAIRE") ?? cleanKey(ownerName);
  const originalOwnerName = text(row, "Propriétaire1_Nom");
  const ownerKind = text(row, "Propriétaire1_StatutImpositionScolaire");
  const companyName = ownerKind === "Personne morale" ? originalOwnerName : null;

  if (!grouped.has(ownerKey)) {
    grouped.set(ownerKey, {
      ownerKey,
      ownerName,
      originalOwnerName,
      companyName,
      mailingAddress: text(row, "Adresse propriétaire - Adresse", "Adresse_Proprio"),
      mailingCity: text(row, "Adresse propriétaire - Ville", "Ville_Proprio"),
      mailingProvince: text(row, "Adresse propriétaire - Province", "QC_1") ?? "QC",
      mailingPostal: text(row, "Adresse propriétaire - Code postal", "code_postal_Proprio"),
      phoneDisplay: text(row, "Propriétaire1_Téléphone"),
      properties: [],
    });
  }

  grouped.get(ownerKey).properties.push({
    matricule,
    address: text(row, "Adresse Immeuble - Adresse", "Adresse Immeuble", "Adresse") ?? "Unknown address",
    city: text(row, "Adresse Immeuble - Ville", "Ville_1", "Ville"),
    postal_code: text(row, "Adresse Immeuble - Code postal", "Code Postal Immeuble"),
    num_units: num(row, "Nb Logements", "Nb Total Unités"),
    cadastre: text(row, "Cadastre"),
    property_type: text(row, "Utilisation Prédominante"),
    evaluation_total: num(row, "Valeur Immeuble"),
    raw: {
      source_row: row.__rowNum__ ?? null,
      address_display: text(row, "Adresse Immeuble"),
    },
  });
}

const existing = await sb
  .from("letter_campaigns")
  .select("id")
  .eq("name", campaignName)
  .maybeSingle();

let campaignId = existing.data?.id;
if (!campaignId) {
  const inserted = await sb
    .from("letter_campaigns")
    .insert({
      name: campaignName,
      city,
      source_file: path.basename(workbookPath),
      mailed_at: mailedAt,
      notes: `Imported from ${workbookPath}`,
    })
    .select("id")
    .single();
  if (inserted.error) throw inserted.error;
  campaignId = inserted.data.id;
} else {
  const update = await sb
    .from("letter_campaigns")
    .update({
      city,
      source_file: path.basename(workbookPath),
      mailed_at: mailedAt,
      notes: `Re-imported from ${workbookPath}`,
    })
    .eq("id", campaignId);
  if (update.error) throw update.error;
  const cleanup = await sb.from("letter_recipients").delete().eq("campaign_id", campaignId);
  if (cleanup.error) throw cleanup.error;
}

const recipientRows = [];
for (const group of grouped.values()) {
  const totalUnits = group.properties.reduce((sum, property) => sum + Number(property.num_units ?? 0), 0);
  recipientRows.push({
    campaign_id: campaignId,
    owner_key: group.ownerKey,
    owner_name: group.ownerName,
    original_owner_name: group.originalOwnerName,
    company_name: group.companyName,
    mailing_address: group.mailingAddress,
    mailing_city: group.mailingCity,
    mailing_province: group.mailingProvince,
    mailing_postal: group.mailingPostal,
    phone_display: group.phoneDisplay,
    bucket: group.properties.length > 1 ? "multi" : "single",
    property_count: group.properties.length,
    total_units: totalUnits || null,
    status: "sent",
    raw: { imported_from: workbookPath },
  });
}

const idByOwnerKey = new Map();
for (const batch of chunk(recipientRows, 500)) {
  const inserted = await sb
    .from("letter_recipients")
    .insert(batch)
    .select("id,owner_key");
  if (inserted.error) throw inserted.error;
  for (const row of inserted.data ?? []) idByOwnerKey.set(row.owner_key, row.id);
}

const propertyRows = [];
for (const group of grouped.values()) {
  const recipientId = idByOwnerKey.get(group.ownerKey);
  if (!recipientId) continue;
  for (const property of group.properties) {
    propertyRows.push({ ...property, recipient_id: recipientId });
  }
}

for (const batch of chunk(propertyRows, 500)) {
  const inserted = await sb.from("letter_recipient_properties").insert(batch);
  if (inserted.error) throw inserted.error;
}

console.log(JSON.stringify({
  ok: true,
  campaignId,
  campaignName,
  recipients: recipientRows.length,
  properties: propertyRows.length,
}, null, 2));
