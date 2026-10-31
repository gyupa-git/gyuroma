/**
 * What this build carries.
 *
 * The Claude consult (💬 in ✨ auto tidy) runs on this computer's Claude
 * login or a person's own API key, and only the owner would use it, so
 * every build leaves it out (`npm run build:app` → dist/, what the launcher
 * serves; `npm run build:dist` → dist-public/, the copy for others).  The
 * code stays: `npm run build:app:claude` builds the app with it, and making
 * this `true` gives it to every build again.
 */
export const WITH_CLAUDE = import.meta.env.VITE_CLAUDE === "1";
