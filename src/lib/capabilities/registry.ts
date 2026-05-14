import builtinRegistry from "shared/registries/capabilities/builtin.json";
import localRegistry from "shared/registries/capabilities/local.json";
import type { CapabilityKind } from "shared/types";
import type { CapabilityRegistryEntry } from "@/lib/capabilities/types";

type RegistryFile = Record<
  string,
  { type: CapabilityKind; source: string; label: string; summary: string; aliases?: string[] }
>;

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRegistry(registry: RegistryFile): CapabilityRegistryEntry[] {
  return Object.values(registry).map((entry) => ({
    type: entry.type,
    source: entry.source as CapabilityRegistryEntry["source"],
    label: entry.label,
    summary: entry.summary,
    aliases: entry.aliases,
  }));
}

const builtinEntries = normalizeRegistry(builtinRegistry as RegistryFile);
const localEntries = normalizeRegistry(localRegistry as RegistryFile);

export function findBuiltinCapability(label: string, kind: CapabilityKind): CapabilityRegistryEntry | null {
  const target = normalizeName(label);
  return (
    builtinEntries.find((entry) => {
      if (entry.type !== kind) {
        return false;
      }
      if (normalizeName(entry.label) === target) {
        return true;
      }
      return (entry.aliases ?? []).some((alias) => normalizeName(alias) === target);
    }) ?? null
  );
}

export function findLocalCapability(label: string, kind: CapabilityKind): CapabilityRegistryEntry | null {
  const target = normalizeName(label);
  return (
    localEntries.find((entry) => {
      if (entry.type !== kind) {
        return false;
      }
      if (normalizeName(entry.label) === target) {
        return true;
      }
      return (entry.aliases ?? []).some((alias) => normalizeName(alias) === target);
    }) ?? null
  );
}
