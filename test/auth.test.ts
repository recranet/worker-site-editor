import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSiteCustomer } from "../src/auth.ts";
import { readText } from "../src/store.ts";
import { testR2 } from "./d1.ts";
import { CUSTOMER, ISSUER, mockProvider } from "./provider.ts";
import { auth, signIn, site } from "./site.tsx";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const customer = {
	sub: "c-1",
	email: "info@klant.test",
	email_verified: true,
	name: "Klant",
	[`${ISSUER}/customer_id`]: Number(CUSTOMER),
};

describe("isSiteCustomer", () => {
	it("checks the issuer's customer_id claim against the site's customer", () => {
		expect(isSiteCustomer(customer, auth)).toBe(true);
		expect(isSiteCustomer({ ...customer, [`${ISSUER}/customer_id`]: 7 }, auth)).toBe(false);
		expect(isSiteCustomer({ email: "x@y.test" }, auth)).toBe(false);
		// The claim of another issuer doesn't count.
		expect(isSiteCustomer({ "https://auth.other.test/customer_id": CUSTOMER }, auth)).toBe(false);
	});
});

describe("sign-in through the console", () => {
	it("sends /admin/ to the provider with PKCE", async () => {
		mockProvider(() => customer);
		const { authorize } = await signIn(site());
		expect(authorize.origin + authorize.pathname).toBe(`${ISSUER}/authorize`);
		expect(authorize.searchParams.get("client_id")).toBe("site-client");
		expect(authorize.searchParams.get("redirect_uri")).toBe(
			"https://site.test/api/auth/callback/console",
		);
		expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
		expect(authorize.searchParams.get("scope")).toBe("openid profile email");
	});

	it("lets the site's customer in and saves their text", async () => {
		const calls = mockProvider(() => customer);
		const s = site();
		const { back, jar } = await signIn(s);
		expect(back.status).toBe(302);
		expect(back.headers.get("location")).toBe("/admin/");
		// client_secret_basic at the token endpoint.
		expect(calls.find((c) => c.url === "/token")?.auth).toBe(
			`Basic ${btoa("site-client:site-secret")}`,
		);

		const admin = await s.request("/admin/", { headers: { cookie: jar.header() } });
		expect(admin.headers.get("location")).toBe("/admin/texts/home/body/");

		const screen = await s.request("/admin/texts/home/body/", {
			headers: { cookie: jar.header() },
		});
		const html = await screen.text();
		expect(html).toContain('"email":"info@klant.test"');
		expect(html).toContain('"name":"quote"');
		expect(html).toContain('<script type="module" src="/admin/admin.js">');
		expect(screen.headers.get("cache-control")).toBe("no-store");

		const value = [{ _type: "quote", _key: "q", text: "Nieuw" }];
		const save = await s.request("/admin/texts/home/body/", {
			method: "POST",
			headers: { cookie: jar.header(), origin: "https://site.test" },
			body: new URLSearchParams({ value: JSON.stringify(value) }),
		});
		expect(save.status).toBe(303);
		expect(await readText(s.db, "home", "body")).toEqual(value);
	});

	it("lets staff in: their token carries the site's customer", async () => {
		mockProvider(() => ({
			...customer,
			email: "support@recranet.test",
			[`${ISSUER}/staff`]: true,
		}));
		const s = site();
		const { back, jar } = await signIn(s);
		expect(back.headers.get("location")).toBe("/admin/");
		const admin = await s.request("/admin/", { headers: { cookie: jar.header() } });
		expect(admin.headers.get("location")).toBe("/admin/texts/home/body/");
	});

	it("refuses another customer's account", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		mockProvider(() => ({ ...customer, [`${ISSUER}/customer_id`]: 7 }));
		const s = site();
		const { back, jar } = await signIn(s);
		expect(back.headers.get("location")).toMatch(/^\/admin\/\?error=sign-in/);
		const refused = await s.request("/admin/?error=sign-in", { headers: { cookie: jar.header() } });
		expect(await refused.text()).toContain("Geen toegang");
		const screen = await s.request("/admin/texts/home/body/", {
			headers: { cookie: jar.header() },
		});
		expect(screen.headers.get("location")).toBe("/admin/");
	});
});

describe("without a session", () => {
	beforeEach(() => {
		mockProvider(() => customer);
	});

	it("sends the admin's screens and uploads back to sign-in", async () => {
		const s = site();
		expect((await s.request("/admin/texts/home/body/")).headers.get("location")).toBe("/admin/");
		const upload = await s.request("/admin/media", {
			method: "POST",
			headers: { origin: "https://site.test" },
			body: new FormData(),
		});
		expect(upload.headers.get("location")).toBe("/admin/");
	});

	it("refuses a save from another origin", async () => {
		const s = site();
		const res = await s.request("/admin/texts/home/body/", {
			method: "POST",
			headers: { origin: "https://evil.test", "content-type": "application/x-www-form-urlencoded" },
			body: "value=[]",
		});
		expect(res.status).toBe(403);
	});

	it("has no admin when an auth secret is missing", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const s = site({ auth: { ...auth, clientSecret: "" } });
		expect(s.editor.editing).toBe(false);
		expect((await s.request("/admin/")).status).toBe(404);
		expect(error).toHaveBeenCalledWith(expect.stringContaining("clientSecret"));
	});

	it("takes the env values as they are, undefined ones too", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const partial = site({ auth: { ...auth, secret: undefined } });
		expect(partial.editor.editing).toBe(false);
		expect(error).toHaveBeenCalledWith(expect.stringContaining("secret"));
		error.mockClear();
		// No value at all: a site that doesn't edit yet, off without a word.
		const none = site({ auth: { issuer: undefined, customerId: undefined } });
		expect(none.editor.editing).toBe(false);
		expect(error).not.toHaveBeenCalled();
	});
});

describe("images through R2", () => {
	const png = () => {
		const form = new FormData();
		form.append(
			"file",
			new File([new Uint8Array([137, 80, 78, 71])], "a.png", { type: "image/png" }),
		);
		return form;
	};

	it("uploads to the site's bucket and serves the image", async () => {
		mockProvider(() => customer);
		const media = testR2();
		const s = site({ media });
		const { jar } = await signIn(s);
		const res = await s.request("/admin/media", {
			method: "POST",
			headers: { cookie: jar.header(), origin: "https://site.test" },
			body: png(),
		});
		const { src } = (await res.json()) as { src: string };
		expect(src).toMatch(/^\/media\/[0-9a-f-]{36}\.png$/);
		const image = await s.request(src);
		expect(image.headers.get("content-type")).toBe("image/png");
		expect(image.headers.get("cache-control")).toContain("immutable");
		expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
	});

	it("refuses SVG", async () => {
		mockProvider(() => customer);
		const s = site({ media: testR2() });
		const { jar } = await signIn(s);
		const form = new FormData();
		form.append("file", new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }));
		const res = await s.request("/admin/media", {
			method: "POST",
			headers: { cookie: jar.header(), origin: "https://site.test" },
			body: form,
		});
		expect(res.status).toBe(400);
	});

	it("is off without a bucket: no upload, no image buttons, /media/ a 404", async () => {
		mockProvider(() => customer);
		const s = site();
		const { jar } = await signIn(s);
		const upload = await s.request("/admin/media", {
			method: "POST",
			headers: { cookie: jar.header(), origin: "https://site.test" },
			body: png(),
		});
		expect(upload.status).toBe(404);
		const screen = await (
			await s.request("/admin/texts/home/body/", { headers: { cookie: jar.header() } })
		).text();
		expect(screen).toContain('"media":false');
		expect((await s.request("/media/0b2c7c1e-1f7a-4f0e-9a39-1f1f1f1f1f1f.png")).status).toBe(404);
	});
});
