/** @jsxImportSource react */
import { defineBlockEditor } from "../../client/block-editor.ts";
import type { ImageValue } from "../../fields.ts";

// The generated form, with a live preview of the title on the image above it;
// in the text, the hero as a small banner instead of a card.
export const heroEditor = defineBlockEditor({
	name: "hero",
	Edit: ({ value, fields }) => (
		<>
			<Banner title={value.title} image={value.image} />
			{fields()}
		</>
	),
	Preview: ({ value }) => <Banner title={value.title} image={value.image} />,
});

function Banner(props: { title: unknown; image: unknown }) {
	const image = props.image as ImageValue | undefined;
	return (
		<div
			style={{
				display: "grid",
				placeItems: "center",
				minHeight: "6rem",
				padding: "1rem",
				borderRadius: 6,
				color: image ? "white" : "inherit",
				background: image
					? `linear-gradient(rgb(0 0 0 / 0.45), rgb(0 0 0 / 0.45)), center / cover url("${image.src}?w=960")`
					: "var(--surface)",
				fontSize: "1.4rem",
				fontWeight: 700,
			}}
		>
			{typeof props.title === "string" && props.title ? props.title : "Titel"}
		</div>
	);
}
