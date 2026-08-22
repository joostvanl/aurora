/** Central secret-field check. New secret types go here — not at each call site. */
export function isSecretField(def: { type: string }): boolean {
  return def.type === "password";
}
