import { vi } from "vitest";

export const ISSUER = "https://auth.test";
export const CUSTOMER = "42";

// The console's OpenID provider as a fetch mock: discovery, the token
// endpoint and UserInfo. No jwks_uri, so Better Auth takes the profile from
// UserInfo; the live provider signs ID tokens and Better Auth checks them.
export function mockProvider(profile: () => Record<string, unknown>) {
	const calls: { url: string; auth?: string | null; body?: string }[] = [];
	const real = globalThis.fetch;
	vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		if (url.origin !== ISSUER) return real(input, init);
		calls.push({
			url: url.pathname,
			auth: request.headers.get("authorization"),
			body: request.method === "POST" ? await request.text() : undefined,
		});
		switch (url.pathname) {
			case "/.well-known/openid-configuration":
				return Response.json({
					issuer: ISSUER,
					authorization_endpoint: `${ISSUER}/authorize`,
					token_endpoint: `${ISSUER}/token`,
					userinfo_endpoint: `${ISSUER}/userinfo`,
					scopes_supported: ["openid", "profile", "email"],
					code_challenge_methods_supported: ["S256"],
					id_token_signing_alg_values_supported: ["RS256"],
				});
			case "/token":
				return Response.json({ access_token: "access", token_type: "Bearer", expires_in: 300 });
			case "/userinfo":
				return Response.json(profile());
			default:
				return new Response("not found", { status: 404 });
		}
	});
	return calls;
}

// The cookies a browser would keep between requests.
export class Jar {
	cookies = new Map<string, string>();
	take(res: Response) {
		for (const c of res.headers.getSetCookie()) {
			const [pair] = c.split(";");
			const i = pair.indexOf("=");
			const name = pair.slice(0, i);
			const value = pair.slice(i + 1);
			if (value === "" || /max-age=0/i.test(c)) this.cookies.delete(name);
			else this.cookies.set(name, value);
		}
		return res;
	}
	header() {
		return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
	}
}
