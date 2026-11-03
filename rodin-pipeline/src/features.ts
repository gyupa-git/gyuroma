/**
 * What this build carries.
 *
 * The Claude consult (💬 in 02 colour tidy, 03 mixing, 04 export) runs on
 * this computer's Claude login (or a person's own API key).  Only the owner
 * uses it for now (11-04: "일단 5173, 내 클로드 로그인 먼저"), so:
 * - `npm run build:app` → dist/, what the launcher serves on 5173: with Claude.
 * - `npm run build:dist` → dist-public/, the copy for others: without it.
 */
export const WITH_CLAUDE = import.meta.env.VITE_CLAUDE === "1";
