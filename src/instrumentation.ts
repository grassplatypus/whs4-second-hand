import { getEnv } from "@/features/_shared/env";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    getEnv(); // validates env at server startup; throws (fail-fast) if invalid
  }
}
