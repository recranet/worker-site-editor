import { defineBlock } from "../../blocks.ts";
import { introField, paragraphs, SectionHeader, titleField } from "../ui.tsx";

// Google Maps for an address or place, with the keyless embed URL. Google
// sets its own cookies once it loads; a site with a consent banner loads it
// after consent.
export const map = defineBlock({
	name: "map",
	label: "Kaart (Google Maps)",
	section: true,
	fields: [
		titleField,
		introField,
		{ name: "query", label: "Adres of plaats", kind: "text", required: true },
	],
	render: (value) => (
		<section>
			<div class="container">
				<SectionHeader
					title={value.title}
					intro={paragraphs(value.intro)}
					class="mx-auto text-center lg:w-2/3"
				/>
				<div class="h-[450px] overflow-hidden rounded-md">
					<iframe
						class="size-full border-0"
						title={value.title ?? value.query}
						loading="lazy"
						src={`https://www.google.com/maps?q=${encodeURIComponent(value.query)}&output=embed`}
						referrerpolicy="no-referrer-when-downgrade"
					></iframe>
				</div>
			</div>
		</section>
	),
});
