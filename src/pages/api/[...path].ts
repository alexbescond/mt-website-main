import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { api } from "../../lib/api";
export const prerender = false;
export const ALL: APIRoute = ({ request }) => api(request, env);
