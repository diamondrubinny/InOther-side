import type { z } from "zod";
import { badRequest } from "./errors.js";

/** Parse untrusted input; on failure throw a 400 with field paths and codes (no echo of values). */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), code: i.message }));
    throw badRequest("validation_failed", issues);
  }
  return result.data;
}
