import { describe, expect, it } from "vitest";
import { imageNames, missing } from "../src/client/missing.ts";
import { hasFields, type Field } from "../src/fields.ts";
import { renderContext } from "../src/render.ts";

const src = "/media/0b2c7c1e-1f7a-4f0e-9a39-1f1f1f1f1f1f.png";
const fields = [
	{ name: "banner", label: "Banner", kind: "image", decorative: true },
	{ name: "photo", label: "Foto", kind: "image" },
	{
		name: "cards",
		label: "Kaarten",
		item: "Kaart",
		kind: "items",
		fields: [
			{ name: "background", label: "Achtergrond", kind: "image", decorative: true },
			{ name: "image", label: "Afbeelding", kind: "image", required: true },
		],
	},
] as const satisfies readonly Field[];

describe("image alt texts", () => {
	it("saves a decorative image without one", () => {
		const value = {
			banner: { src, alt: "" },
			cards: [{ _key: "a", background: { src, alt: "" }, image: { src, alt: "Gevel" } }],
		};
		expect(hasFields(value, fields)).toBe(true);
		expect(missing(value, fields)).toBe("");
		// One saved before the field turned decorative still fits.
		expect(hasFields({ banner: { src, alt: "Duinen" } }, fields)).toBe(true);
	});

	it("refuses any other image without one, also in a list item", () => {
		const photo = { photo: { src, alt: " " } };
		expect(hasFields(photo, fields)).toBe(false);
		expect(missing(photo, fields)).toBe("Beschrijf de afbeelding bij Foto voor wie hem niet ziet.");

		const card = { cards: [{ _key: "a", image: { src, alt: "" } }] };
		expect(hasFields(card, fields)).toBe(false);
		expect(missing(card, fields)).toBe(
			"Kaart: Beschrijf de afbeelding bij Afbeelding voor wie hem niet ziet.",
		);
	});

	it("renders a decorative image with an empty alt", () => {
		expect(renderContext(false).image({ src, alt: "" })).toContain(`alt=""`);
	});

	it("still asks for a required decorative image", () => {
		const required = [
			{ name: "banner", label: "Banner", kind: "image", decorative: true, required: true },
		] as const satisfies readonly Field[];
		expect(hasFields({}, required)).toBe(false);
		expect(missing({}, required)).toBe("Kies een afbeelding bij Banner.");
	});
});

describe("image field names", () => {
	const src = "/media/3f2a.webp";

	it("names the preview by its alt text", () => {
		expect(imageNames("Banner bovenaan", { src, alt: " Strand bij zonsondergang " }).preview).toBe(
			"Strand bij zonsondergang",
		);
	});

	it("names a preview without alt text, decorative or not yet described, by its field", () => {
		expect(imageNames("Banner bovenaan", { src, alt: "" }).preview).toBe(
			"Gekozen afbeelding bij Banner bovenaan",
		);
	});

	it("says which field the controls belong to", () => {
		const names = imageNames("Foto van Kaart 2", { src, alt: "" });
		expect(names.alt).toBe("Alt-tekst bij Foto van Kaart 2");
		expect(names.remove).toBe("Afbeelding bij Foto van Kaart 2 verwijderen");
		expect(names.file).toBe("Andere afbeelding bij Foto van Kaart 2 kiezen");
		expect(imageNames("Banner bovenaan", undefined).file).toBe(
			"Afbeelding bij Banner bovenaan kiezen",
		);
	});
});
