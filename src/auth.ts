import { betterAuth } from "better-auth/minimal";
import { genericOAuth } from "better-auth/plugins/generic-oauth";

// Sign-in through the console's OpenID provider (auth.recranet.dev or
// auth.elloro.dev). The site keeps no passwords, users or sessions of its
// own: Better Auth without a database keeps the session in an encrypted
// cookie. Staff sign in through the same provider ("Medewerker? Log in via de
// console"); their tokens carry this client's customer too, so the check below
// lets them in without a change.
export type AuthOptions = {
	// The provider: "https://auth.recranet.dev" or "https://auth.elloro.dev".
	issuer: string;
	// The console customer the site belongs to. Tokens for another customer are refused.
	customerId: string | number;
	// The site's OIDC client (`console oidc-clients create`): the ID from the
	// site's config, the secret from its secrets.
	clientId: string;
	clientSecret: string;
	// Encrypts the session cookie: `openssl rand -base64 32`, a site secret.
	secret: string;
};

// What a site passes: its env values as they are, any of them missing.
export type AuthInput = { [K in keyof AuthOptions]?: AuthOptions[K] | undefined };

export const PROVIDER_ID = "console";

// Whether an ID token or UserInfo profile belongs to the site's customer.
// The provider already refuses other customers' addresses; this holds a
// client that was handed to the wrong site.
export function isSiteCustomer(profile: Record<string, unknown>, options: AuthOptions): boolean {
	const claim = profile[`${options.issuer}/customer_id`];
	return claim !== undefined && claim !== null && String(claim) === String(options.customerId);
}

export function createAuth(options: AuthOptions, origin: string) {
	return betterAuth({
		baseURL: origin,
		secret: options.secret,
		session: { expiresIn: 12 * 60 * 60 },
		plugins: [
			genericOAuth({
				config: [
					{
						providerId: PROVIDER_ID,
						discoveryUrl: `${options.issuer}/.well-known/openid-configuration`,
						clientId: options.clientId,
						clientSecret: options.clientSecret,
						scopes: ["openid", "profile", "email"],
						authentication: "basic",
						pkce: true,
						// Without an email Better Auth refuses the sign-in and sends the
						// visitor to errorCallbackURL.
						mapProfileToUser(profile) {
							if (isSiteCustomer(profile, options)) return {};
							console.error(
								"sign-in refused: another customer",
								profile[`${options.issuer}/customer_id`],
							);
							return { email: "" };
						},
					},
				],
			}),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
