/** @jsxImportSource react */
/// <reference lib="dom" />
// The admin screens: switch texts, edit one with the Portable Text editor,
// edit a page's or an item's fields, and a collection's list of items.
// React because @portabletext/editor needs it; the controls are Base UI,
// styled in admin.css. It renders from the JSON the server put in the page
// (index.tsx), and Save is a plain form POST.
import { Dialog } from "@base-ui/react/dialog";
import { Input } from "@base-ui/react/input";
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import { Toggle } from "@base-ui/react/toggle";
import { Toolbar } from "@base-ui/react/toolbar";
import {
	defineAnnotation,
	defineBlockObject,
	defineDecorator,
	defineSchema,
	defineTextBlock,
	EditorProvider,
	PortableTextEditable,
	useEditor,
	useEditorSelector,
	type BlockPath,
	type PortableTextBlock,
} from "@portabletext/editor";
import { NodePlugin } from "@portabletext/editor/plugins";
import {
	getActiveAnnotations,
	getActiveListItem,
	getActiveStyle,
	isActiveDecorator,
} from "@portabletext/editor/selectors";
import { Fragment, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AdminData } from "../admin-data.ts";
import type { Field, ImageValue, ItemField } from "../fields.ts";
import type { BlockEditor, BlockFields } from "./block-editor.ts";

// The server puts the screen's data in the page (routes.tsx), with the site's
// blocks (their fields) and text styles; the site's bundle passes the blocks'
// own editor UI (defineBlockEditor) to mountAdmin. Both are set once, before
// the first render.
let data: AdminData;
type Part = AdminData["blocks"][number];
let parts: Record<string, Part> = {};
let editors = new Map<string, BlockEditor>();
let blockStyles: NonNullable<AdminData["textStyles"]["blockStyles"]> = {};
let decorators: NonNullable<AdminData["textStyles"]["decorators"]> = {};
let linkStyles: NonNullable<AdminData["textStyles"]["linkStyles"]> = {};

// The admin's screen, in the element with id "admin". The site's admin entry
// calls this with its blocks' editors: mountAdmin({ editors: [hero, quote] }).
export function mountAdmin(options: { editors?: readonly BlockEditor[] } = {}) {
	data = JSON.parse(document.getElementById("admin-data")!.textContent!) as AdminData;
	parts = Object.fromEntries(data.blocks.map((b) => [b.name, b]));
	editors = new Map((options.editors ?? []).map((e) => [e.name, e]));
	for (const name of editors.keys()) {
		if (!parts[name])
			console.warn(`block editor "${name}" has no block on the server (createEditor blocks)`);
	}
	({ blockStyles = {}, decorators = {}, linkStyles = {} } = data.textStyles);
	const schemaDefinition = buildSchema();
	const nodes = buildNodes();
	createRoot(document.getElementById("admin")!).render(
		<Screen schemaDefinition={schemaDefinition} nodes={nodes} />,
	);
}

// What the customer can do: everything @portabletext/to-html renders on the
// public pages without custom components, images (blocks.ts, media.ts), the
// site's own text styles and its blocks.
const buildSchema = () =>
	defineSchema({
		decorators: [
			{ name: "strong" },
			{ name: "em" },
			{ name: "underline" },
			{ name: "strike-through" },
			...Object.keys(decorators).map((name) => ({ name })),
		],
		styles: [
			{ name: "normal" },
			{ name: "h2" },
			{ name: "h3" },
			{ name: "blockquote" },
			...Object.keys(blockStyles).map((name) => ({ name })),
		],
		annotations: ["link", ...Object.keys(linkStyles)].map((name) => ({
			name,
			fields: [{ name: "href", type: "string" }],
		})),
		lists: [{ name: "bullet" }, { name: "number" }],
		inlineObjects: [],
		blockObjects: [
			{
				name: "image",
				fields: [
					{ name: "src", type: "string" },
					{ name: "alt", type: "string" },
					{ name: "width", type: "number" },
					{ name: "height", type: "number" },
				],
			},
			// Several images, each { _key, src, alt, width, height }.
			{ name: "gallery", fields: [{ name: "images", type: "array" }] },
			// The page parts (parts.ts): lists are arrays, images objects, the rest strings.
			...Object.entries(parts).map(([name, part]) => ({
				name,
				fields: part.fields.map((f) => ({
					name: f.name,
					type:
						f.kind === "items" || f.kind === "choices"
							? ("array" as const)
							: f.kind === "image"
								? ("object" as const)
								: ("string" as const),
				})),
			})),
		],
	});

type Image = { _key?: string; src: string; alt: string; width?: number; height?: number };

// Small previews in the editor: /media/ scales them when IMAGES is on, and
// serves the original otherwise.
const preview = (src?: string) => (src ? `${src}?w=480` : undefined);

// The gallery's render can't hold state, so its Bewerken button sends the
// block's path and images here, and GalleryEditor (outside the editable area,
// so typing in the dialog doesn't reach the editor) opens the dialog.
type GalleryEdit = { path: BlockPath; images: Image[] };
const galleryEdits = new EventTarget();
function editGallery(path: BlockPath, images: Image[]) {
	galleryEdits.dispatchEvent(new CustomEvent<GalleryEdit>("edit", { detail: { path, images } }));
}

// A part's stored fields (parts.ts), and the edit that opens its form: a new
// part has no path yet.
type PartValue = { _type?: string; _key?: string; [field: string]: unknown };
type Row = { _key: string; [field: string]: unknown };
type PartEdit = { type: string; path?: BlockPath; value: PartValue };
const partEdits = new EventTarget();
function editPart(edit: PartEdit) {
	partEdits.dispatchEvent(new CustomEvent<PartEdit>("edit", { detail: edit }));
}

const asText = (v: unknown) => (typeof v === "string" ? v : "");
const asRows = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
const asList = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const asImage = (v: unknown) =>
	typeof v === "object" && v !== null && typeof (v as Image).src === "string"
		? (v as Image)
		: undefined;
const newKey = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// The card's line: the first text field that has a value, else the first item's.
function summary(value: PartValue, fields: readonly Field[]): string {
	for (const f of fields) {
		if ((f.kind === "text" || f.kind === "textarea") && asText(value[f.name]))
			return asText(value[f.name]);
	}
	for (const f of fields) {
		if (f.kind !== "items") continue;
		const list = asRows(value[f.name]);
		if (list.length === 0) continue;
		const first = summary(list[0], f.fields);
		return list.length > 1 ? `${first} en ${list.length - 1} meer` : first;
	}
	return "Nog leeg";
}

function firstImage(value: PartValue, fields: readonly Field[]): Image | undefined {
	for (const f of fields) {
		if (f.kind === "image" && asImage(value[f.name])) return asImage(value[f.name]);
		if (f.kind === "items") {
			for (const row of asRows(value[f.name])) {
				const image = firstImage(row, f.fields);
				if (image) return image;
			}
		}
	}
	return undefined;
}

const buildNodes = () => [
	defineTextBlock({
		type: "block",
		render: ({ attributes, children, node }) => {
			if (node.listItem)
				return (
					<div {...attributes} className={`pt-${node.listItem}`}>
						{children}
					</div>
				);
			if (node.style === "h2") return <h2 {...attributes}>{children}</h2>;
			if (node.style === "h3") return <h3 {...attributes}>{children}</h3>;
			if (node.style === "blockquote") return <blockquote {...attributes}>{children}</blockquote>;
			const custom = node.style ? blockStyles[node.style] : undefined;
			if (custom) {
				const Tag = custom.tag as "p";
				return (
					<Tag {...attributes} className={custom.class}>
						{children}
					</Tag>
				);
			}
			return <p {...attributes}>{children}</p>;
		},
	}),
	defineDecorator({ type: "strong", render: ({ children }) => <strong>{children}</strong> }),
	defineDecorator({ type: "em", render: ({ children }) => <em>{children}</em> }),
	defineDecorator({ type: "underline", render: ({ children }) => <u>{children}</u> }),
	defineDecorator({ type: "strike-through", render: ({ children }) => <s>{children}</s> }),
	...Object.entries(decorators).map(([type, d]) =>
		defineDecorator({
			type,
			render: ({ children }) => {
				const Tag = d.tag as "span";
				return <Tag className={d.class}>{children}</Tag>;
			},
		}),
	),
	defineBlockObject({
		type: "image",
		render: ({ attributes, children, node, selected }) => {
			const image = node as { src?: string; alt?: string };
			return (
				<figure {...attributes} className={selected ? "pt-image selected" : "pt-image"}>
					{children}
					<img src={preview(image.src)} alt={image.alt ?? ""} />
					{image.alt ? <figcaption>Alt-tekst: {image.alt}</figcaption> : null}
				</figure>
			);
		},
	}),
	defineBlockObject({
		type: "gallery",
		render: ({ attributes, children, node, path, selected }) => {
			const images = ((node as { images?: Image[] }).images ?? []) as Image[];
			return (
				<figure {...attributes} className={selected ? "pt-gallery selected" : "pt-gallery"}>
					{children}
					<div>
						{images.map((image) => (
							<img key={image._key ?? image.src} src={preview(image.src)} alt={image.alt} />
						))}
					</div>
					<figcaption contentEditable={false}>
						Galerij, {images.length} afbeeldingen{" "}
						<button
							type="button"
							className="button small"
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => editGallery(path as BlockPath, images)}
						>
							Bewerken
						</button>
					</figcaption>
				</figure>
			);
		},
	}),
	// A part shows as a card with its name, a summary and Bewerken.
	...Object.entries(parts).map(([type, part]) =>
		defineBlockObject({
			type,
			render: ({ attributes, children, node, path, selected }) => {
				const value = node as PartValue;
				const image = firstImage(value, part.fields);
				const Preview = editors.get(type)?.Preview;
				return (
					<div {...attributes} className={selected ? "pt-part selected" : "pt-part"}>
						{children}
						<div className="pt-part-body" contentEditable={false}>
							{Preview ? (
								<div className="pt-part-preview">
									<div className="pt-part-type">{part.label}</div>
									<Preview value={value as BlockFields} />
								</div>
							) : (
								<>
									{image ? <img src={preview(image.src)} alt="" /> : null}
									<div>
										<div className="pt-part-type">{part.label}</div>
										<div className="pt-part-summary">{summary(value, part.fields)}</div>
									</div>
								</>
							)}
							<button
								type="button"
								className="button small"
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => editPart({ type, path: path as BlockPath, value })}
							>
								Bewerken
							</button>
						</div>
					</div>
				);
			},
		}),
	),
	...["link", ...Object.keys(linkStyles)].map((type) =>
		defineAnnotation({
			type,
			render: ({ children, annotation }) => (
				<a
					href={typeof annotation.href === "string" ? annotation.href : undefined}
					className={linkStyles[type]?.class}
				>
					{children}
				</a>
			),
		}),
	),
];

// Each screen has its own URL, so switching loads that page.
function Switcher() {
	// The switcher's items, grouped by page. The trigger shows "Page: Label".
	const groups = data.nav.map((group) => ({
		value: group.title,
		items: group.links.map((link) => ({
			value: link.href,
			label: `${group.title}: ${link.label}`,
		})),
	}));
	return (
		<Select.Root
			items={groups}
			value={data.current}
			onValueChange={(value) => {
				if (value && value !== data.current) window.location.assign(value);
			}}
		>
			<Select.Trigger className="select" aria-label="Scherm">
				<Select.Value />
				<Select.Icon className="select-icon">▾</Select.Icon>
			</Select.Trigger>
			<Select.Portal>
				<Select.Positioner sideOffset={4} alignItemWithTrigger={false} align="start">
					<Select.Popup className="popup select-popup">
						<Select.List>
							{data.nav.map((group) => (
								<Select.Group key={group.title} className="select-group">
									<Select.GroupLabel className="select-group-label">
										{group.title}
									</Select.GroupLabel>
									{group.links.map((link) => (
										<Select.Item key={link.href} value={link.href} className="select-item">
											<Select.ItemIndicator className="select-check">✓</Select.ItemIndicator>
											<Select.ItemText>{link.label}</Select.ItemText>
										</Select.Item>
									))}
								</Select.Group>
							))}
						</Select.List>
					</Select.Popup>
				</Select.Positioner>
			</Select.Portal>
		</Select.Root>
	);
}

// A click on a format button leaves the focus and selection in the editor.
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

function FormatToolbar() {
	const editor = useEditor();
	const style = useEditorSelector(editor, getActiveStyle);
	const list = useEditorSelector(editor, getActiveListItem);
	const bold = useEditorSelector(editor, isActiveDecorator("strong"));
	const italic = useEditorSelector(editor, isActiveDecorator("em"));
	const underline = useEditorSelector(editor, isActiveDecorator("underline"));
	const strike = useEditorSelector(editor, isActiveDecorator("strike-through"));
	// The site's own decorators that are on, as one string so it compares by value.
	const own = useEditorSelector(editor, (s) =>
		Object.keys(decorators)
			.filter((name) => isActiveDecorator(name)(s))
			.join(" "),
	).split(" ");

	const send = (event: Parameters<typeof editor.send>[0]) => {
		editor.send(event);
		editor.send({ type: "focus" });
	};
	const toggle = (label: string, title: string, pressed: boolean, onClick: () => void) => (
		<Toolbar.Button
			className="tool"
			aria-label={title}
			title={title}
			onMouseDown={keepFocus}
			render={<Toggle pressed={pressed} onPressedChange={onClick} />}
		>
			{label}
		</Toolbar.Button>
	);
	const button = (label: string, title: string, onClick: () => void) => (
		<Toolbar.Button
			className="tool"
			aria-label={title}
			title={title}
			onMouseDown={keepFocus}
			onClick={onClick}
		>
			{label}
		</Toolbar.Button>
	);
	const decorator = (name: string) => () => send({ type: "decorator.toggle", decorator: name });
	const blockStyle = (name: string) => () => send({ type: "style.toggle", style: name });
	const listItem = (name: string) => () => send({ type: "list item.toggle", listItem: name });

	return (
		<Toolbar.Root className="toolbar" aria-label="Opmaak">
			<Toolbar.Group className="tool-group" aria-label="Tekst">
				{toggle("B", "Vet", bold, decorator("strong"))}
				{toggle("I", "Cursief", italic, decorator("em"))}
				{toggle("U", "Onderstreept", underline, decorator("underline"))}
				{toggle("S", "Doorgehaald", strike, decorator("strike-through"))}
				{Object.entries(decorators).map(([name, d]) => (
					<Fragment key={name}>
						{toggle(d.label, d.label, own.includes(name), decorator(name))}
					</Fragment>
				))}
			</Toolbar.Group>
			<Toolbar.Separator className="separator" />
			<Toolbar.Group className="tool-group" aria-label="Alinea">
				{toggle("H2", "Kop", style === "h2", blockStyle("h2"))}
				{toggle("H3", "Subkop", style === "h3", blockStyle("h3"))}
				{toggle("❝", "Citaat", style === "blockquote", blockStyle("blockquote"))}
				{Object.entries(blockStyles).map(([name, s]) => (
					<Fragment key={name}>
						{toggle(s.label, s.label, style === name, blockStyle(name))}
					</Fragment>
				))}
				{toggle("•", "Lijst", list === "bullet", listItem("bullet"))}
				{toggle("1.", "Genummerde lijst", list === "number", listItem("number"))}
			</Toolbar.Group>
			<Toolbar.Separator className="separator" />
			<LinkPopover name="link" label="Link" send={send} />
			{Object.entries(linkStyles).map(([name, l]) => (
				<LinkPopover key={name} name={name} label={l.label} send={send} />
			))}
			{data.media && <ImagePopover />}
			{data.media && <GalleryPopover />}
			<PartPopover />
			<Toolbar.Separator className="separator" />
			<Toolbar.Group className="tool-group" aria-label="Geschiedenis">
				{button("↶", "Ongedaan maken", () => send({ type: "history.undo" }))}
				{button("↷", "Opnieuw", () => send({ type: "history.redo" }))}
			</Toolbar.Group>
			<span className="spacer"></span>
			<Saved />
			<Toolbar.Button type="submit" className="button primary">
				Opslaan
			</Toolbar.Button>
		</Toolbar.Root>
	);
}

// Adds, changes or removes the link on the selected text: a plain link, or
// one of the site's link styles (text-styles.ts).
function LinkPopover(props: {
	name: string;
	label: string;
	send: ReturnType<typeof useEditor>["send"];
}) {
	const editor = useEditor();
	const link = useEditorSelector(editor, (s) =>
		getActiveAnnotations(s).find((a) => a._type === props.name),
	);
	const [open, setOpen] = useState(false);
	const [href, setHref] = useState("");

	const apply = () => {
		setOpen(false);
		if (link) props.send({ type: "annotation.remove", annotation: { name: props.name } });
		if (href.trim() !== "") {
			props.send({ type: "annotation.add", annotation: { name: props.name, value: { href } } });
		}
		editor.send({ type: "focus" });
	};

	return (
		<Popover.Root
			open={open}
			onOpenChange={(next) => {
				if (next) setHref(typeof link?.href === "string" ? link.href : "");
				setOpen(next);
			}}
		>
			<Popover.Trigger
				render={<Toolbar.Button className="tool" data-pressed={link ? "" : undefined} />}
			>
				{props.label}
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner sideOffset={4} align="start">
					<Popover.Popup className="popup link-popup">
						<Popover.Title className="popup-title">{props.label}</Popover.Title>
						<Input
							className="input"
							type="url"
							placeholder="https://…"
							aria-label="Adres van de link"
							value={href}
							onValueChange={setHref}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									apply();
								}
							}}
						/>
						<div className="row">
							<button type="button" className="button primary" onClick={apply}>
								{href.trim() === "" && link ? "Verwijderen" : "Toepassen"}
							</button>
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

// Uploads one image to R2 (POST /admin/media). The text keeps only its path
// and size; Save stores it like the rest.
async function upload(file: File, alt: string): Promise<ImageValue> {
	const bitmap = await createImageBitmap(file);
	const body = new FormData();
	body.append("file", file);
	const res = await fetch("/admin/media", { method: "POST", body });
	if (!res.ok) throw new Error(await res.text());
	const { src } = (await res.json()) as { src: string };
	return { src, alt: alt.trim(), width: bitmap.width, height: bitmap.height };
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

// One image, inserted as an image block at the cursor.
function ImagePopover() {
	const editor = useEditor();
	const [open, setOpen] = useState(false);
	const [file, setFile] = useState<File | null>(null);
	const [alt, setAlt] = useState("");
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState("");

	const insert = async () => {
		if (!file) return setProblem("Kies een afbeelding.");
		if (alt.trim() === "") return setProblem("Beschrijf de afbeelding voor wie hem niet ziet.");
		setBusy(true);
		setProblem("");
		try {
			const value = await upload(file, alt);
			editor.send({
				type: "insert.block object",
				blockObject: { name: "image", value },
				placement: "auto",
			});
			editor.send({ type: "focus" });
			setOpen(false);
		} catch (e) {
			setProblem((e as Error).message || "Uploaden is niet gelukt.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Popover.Root
			open={open}
			onOpenChange={(next) => {
				if (next) {
					setFile(null);
					setAlt("");
					setProblem("");
				}
				setOpen(next);
			}}
		>
			<Popover.Trigger render={<Toolbar.Button className="tool" />}>Afbeelding</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner sideOffset={4} align="start">
					<Popover.Popup className="popup link-popup">
						<Popover.Title className="popup-title">Afbeelding</Popover.Title>
						<input
							className="file"
							type="file"
							accept={ACCEPT}
							aria-label="Afbeelding (JPEG, PNG, WebP of AVIF, tot 20 MB)"
							onChange={(event) => setFile(event.target.files?.[0] ?? null)}
						/>
						<Input
							className="input"
							placeholder="Wat staat erop?"
							aria-label="Alt-tekst"
							value={alt}
							onValueChange={setAlt}
						/>
						{problem && (
							<p className="problem" role="alert">
								{problem}
							</p>
						)}
						<div className="row">
							<button type="button" className="button primary" onClick={insert} disabled={busy}>
								{busy ? "Bezig…" : "Invoegen"}
							</button>
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

// Several images, inserted as one gallery block. Each needs its alt text.
function GalleryPopover() {
	const editor = useEditor();
	const [open, setOpen] = useState(false);
	const [items, setItems] = useState<{ file: File; alt: string }[]>([]);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState("");

	const insert = async () => {
		if (items.length === 0) return setProblem("Kies een of meer afbeeldingen.");
		if (items.some((item) => item.alt.trim() === ""))
			return setProblem("Beschrijf elke afbeelding voor wie hem niet ziet.");
		setBusy(true);
		setProblem("");
		try {
			const images: Image[] = [];
			for (const [i, item] of items.entries()) {
				images.push({ _key: `g${Date.now()}${i}`, ...(await upload(item.file, item.alt)) });
			}
			editor.send({
				type: "insert.block object",
				blockObject: { name: "gallery", value: { images } },
				placement: "auto",
			});
			editor.send({ type: "focus" });
			setOpen(false);
		} catch (e) {
			setProblem((e as Error).message || "Uploaden is niet gelukt.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Popover.Root
			open={open}
			onOpenChange={(next) => {
				if (next) {
					setItems([]);
					setProblem("");
				}
				setOpen(next);
			}}
		>
			<Popover.Trigger render={<Toolbar.Button className="tool" />}>Galerij</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner sideOffset={4} align="start">
					<Popover.Popup className="popup link-popup gallery-popup">
						<Popover.Title className="popup-title">Galerij</Popover.Title>
						<input
							className="file"
							type="file"
							multiple
							accept={ACCEPT}
							aria-label="Afbeeldingen (JPEG, PNG, WebP of AVIF, tot 20 MB per stuk)"
							onChange={(event) =>
								setItems([...(event.target.files ?? [])].map((file) => ({ file, alt: "" })))
							}
						/>
						{items.map((item, i) => (
							<Input
								key={item.file.name + i}
								className="input"
								placeholder={`Wat staat er op ${item.file.name}?`}
								aria-label={`Alt-tekst voor ${item.file.name}`}
								value={item.alt}
								onValueChange={(alt) =>
									setItems(items.map((it, j) => (j === i ? { ...it, alt } : it)))
								}
							/>
						))}
						{problem && (
							<p className="problem" role="alert">
								{problem}
							</p>
						)}
						<div className="row">
							<button type="button" className="button primary" onClick={insert} disabled={busy}>
								{busy ? "Bezig…" : "Invoegen"}
							</button>
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

// Edits a gallery in place: alt texts, order, remove, add. Toepassen writes
// the list back into the same block; Save stores it as usual.
function GalleryEditor() {
	const editor = useEditor();
	const [edit, setEdit] = useState<GalleryEdit | null>(null);
	const [images, setImages] = useState<Image[]>([]);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState("");

	useEffect(() => {
		const open = (event: Event) => {
			const detail = (event as CustomEvent<GalleryEdit>).detail;
			setEdit(detail);
			setImages(detail.images.map((image) => ({ ...image })));
			setProblem("");
		};
		galleryEdits.addEventListener("edit", open);
		return () => galleryEdits.removeEventListener("edit", open);
	}, []);

	const change = (i: number, next: Partial<Image>) =>
		setImages(images.map((image, j) => (j === i ? { ...image, ...next } : image)));
	const move = (i: number, by: number) => {
		const list = [...images];
		const [image] = list.splice(i, 1);
		list.splice(i + by, 0, image);
		setImages(list);
	};

	const add = async (files: File[]) => {
		setBusy(true);
		setProblem("");
		try {
			const added: Image[] = [];
			for (const [i, file] of files.entries()) {
				added.push({ _key: `g${Date.now()}${i}`, ...(await upload(file, "")) });
			}
			setImages((current) => [...current, ...added]);
		} catch (e) {
			setProblem((e as Error).message || "Uploaden is niet gelukt.");
		} finally {
			setBusy(false);
		}
	};

	const apply = () => {
		if (!edit) return;
		if (images.length === 0) return setProblem("Een galerij heeft minstens een afbeelding.");
		if (images.some((image) => image.alt.trim() === ""))
			return setProblem("Beschrijf elke afbeelding voor wie hem niet ziet.");
		editor.send({
			type: "block.set",
			at: edit.path,
			props: { images: images.map((image) => ({ ...image, alt: image.alt.trim() })) },
		});
		setEdit(null);
	};

	return (
		<Dialog.Root open={edit !== null} onOpenChange={(open) => !open && setEdit(null)}>
			<Dialog.Portal>
				<Dialog.Backdrop className="backdrop" />
				<Dialog.Popup className="popup dialog">
					<Dialog.Title className="popup-title">Galerij bewerken</Dialog.Title>
					<ol className="gallery-list">
						{images.map((image, i) => (
							<li key={image._key ?? image.src}>
								<img src={preview(image.src)} alt="" />
								<Input
									className="input"
									placeholder="Wat staat erop?"
									aria-label={`Alt-tekst van afbeelding ${i + 1}`}
									value={image.alt}
									onValueChange={(alt) => change(i, { alt })}
								/>
								<button
									type="button"
									className="button small"
									aria-label="Omhoog"
									disabled={i === 0}
									onClick={() => move(i, -1)}
								>
									↑
								</button>
								<button
									type="button"
									className="button small"
									aria-label="Omlaag"
									disabled={i === images.length - 1}
									onClick={() => move(i, 1)}
								>
									↓
								</button>
								<button
									type="button"
									className="button small"
									aria-label="Verwijderen"
									onClick={() => setImages(images.filter((_, j) => j !== i))}
								>
									×
								</button>
							</li>
						))}
					</ol>
					<label className="add-images">
						Afbeeldingen toevoegen
						<input
							className="file"
							type="file"
							multiple
							accept={ACCEPT}
							disabled={busy}
							onChange={(event) => {
								const files = [...(event.target.files ?? [])];
								event.target.value = "";
								if (files.length > 0) void add(files);
							}}
						/>
					</label>
					{problem && (
						<p className="problem" role="alert">
							{problem}
						</p>
					)}
					<div className="row">
						<button type="button" className="button primary" onClick={apply} disabled={busy}>
							{busy ? "Bezig…" : "Toepassen"}
						</button>
						<Dialog.Close className="button">Annuleren</Dialog.Close>
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

// The parts menu: picking one opens its empty form; Invoegen in the form
// puts it at the cursor.
function PartPopover() {
	const [open, setOpen] = useState(false);
	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger render={<Toolbar.Button className="tool" />}>Onderdeel</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner sideOffset={4} align="start">
					<Popover.Popup className="popup part-menu">
						<Popover.Title className="popup-title">Onderdeel invoegen</Popover.Title>
						{Object.entries(parts).map(([type, part]) => (
							<button
								key={type}
								type="button"
								className="part-menu-item"
								onClick={() => {
									setOpen(false);
									editPart({ type, value: {} });
								}}
							>
								{part.label}
							</button>
						))}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

// What's missing before a part or item can be applied, or "" when it's complete.
function missing(value: PartValue, fields: readonly Field[]): string {
	for (const f of fields) {
		const v = value[f.name];
		if (f.kind === "items") {
			for (const row of asRows(v)) {
				const problem = missing(row, f.fields);
				if (problem) return `${f.item}: ${problem}`;
			}
		} else if (f.kind === "image") {
			const image = asImage(v);
			if (!image && f.required) return `Kies een afbeelding bij ${f.label}.`;
			if (image && image.alt.trim() === "")
				return `Beschrijf de afbeelding bij ${f.label} voor wie hem niet ziet.`;
		} else if (f.kind === "choices") {
			if (f.required && asList(v).length === 0) return `Kies minstens een ${f.label}.`;
		} else if ("required" in f && f.required && asText(v).trim() === "") {
			return `Vul ${f.label} in.`;
		}
	}
	return "";
}

// The form for one part, built from its fields (parts.ts). Toepassen writes
// the fields into the block (or inserts a new one); Save stores it as usual.
function PartEditor() {
	const editor = useEditor();
	const [edit, setEdit] = useState<PartEdit | null>(null);
	const [value, setValue] = useState<PartValue>({});
	const [problem, setProblem] = useState("");

	useEffect(() => {
		const open = (event: Event) => {
			const detail = (event as CustomEvent<PartEdit>).detail;
			const { _type, _key, ...fields } = detail.value;
			setEdit(detail);
			setValue(structuredClone(fields));
			setProblem("");
		};
		partEdits.addEventListener("edit", open);
		return () => partEdits.removeEventListener("edit", open);
	}, []);

	const part = edit ? parts[edit.type] : undefined;
	const Edit = edit ? editors.get(edit.type)?.Edit : undefined;

	const apply = () => {
		if (!edit || !part) return;
		const problem =
			missing(value, part.fields) || editors.get(edit.type)?.check?.(value as BlockFields) || "";
		if (problem) return setProblem(problem);
		if (edit.path) {
			// Emptied fields leave the block, set ones are written.
			const empty = part.fields
				.map((f) => f.name)
				.filter((name) => value[name] === undefined || value[name] === "");
			const set = Object.fromEntries(
				Object.entries(value).filter(([name]) => !empty.includes(name)),
			);
			editor.send({ type: "block.set", at: edit.path, props: set });
			if (empty.length) editor.send({ type: "block.unset", at: edit.path, props: empty });
		} else {
			editor.send({
				type: "insert.block object",
				blockObject: { name: edit.type, value },
				placement: "auto",
			});
		}
		editor.send({ type: "focus" });
		setEdit(null);
	};

	return (
		<Dialog.Root open={edit !== null} onOpenChange={(open) => !open && setEdit(null)}>
			<Dialog.Portal>
				<Dialog.Backdrop className="backdrop" />
				<Dialog.Popup className="popup dialog">
					<Dialog.Title className="popup-title">{part?.label}</Dialog.Title>
					{part &&
						(Edit ? (
							<Edit
								value={value as BlockFields}
								onChange={(next) => setValue((current) => ({ ...current, ...next }))}
								upload={upload}
								media={data.media}
								fields={(names?: string[]) => (
									<Fields
										fields={names ? part.fields.filter((f) => names.includes(f.name)) : part.fields}
										value={value}
										onChange={(next) => setValue((current) => ({ ...current, ...next }))}
									/>
								)}
							/>
						) : (
							<Fields
								fields={part.fields}
								value={value}
								onChange={(next) => setValue((current) => ({ ...current, ...next }))}
							/>
						))}
					{problem && (
						<p className="problem" role="alert">
							{problem}
						</p>
					)}
					<div className="row">
						<button type="button" className="button primary" onClick={apply}>
							{edit?.path ? "Toepassen" : "Invoegen"}
						</button>
						<Dialog.Close className="button">Annuleren</Dialog.Close>
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function Fields(props: {
	fields: readonly Field[];
	value: PartValue;
	onChange: (next: PartValue) => void;
}) {
	return (
		<div className="fields">
			{props.fields.map((f) =>
				f.kind === "items" ? (
					<Items
						key={f.name}
						field={f}
						rows={asRows(props.value[f.name])}
						onChange={(rows) => props.onChange({ [f.name]: rows })}
					/>
				) : (
					<FieldInput
						key={f.name}
						field={f}
						value={props.value[f.name]}
						onChange={(v) => props.onChange({ [f.name]: v })}
					/>
				),
			)}
		</div>
	);
}

// A list field: each item's fields, with move, remove and add.
function Items(props: {
	field: Extract<Field, { kind: "items" }>;
	rows: Row[];
	onChange: (rows: Row[]) => void;
}) {
	const { field, rows } = props;
	const set = (i: number, next: PartValue) =>
		props.onChange(rows.map((row, j) => (j === i ? { ...row, ...next } : row)));
	const move = (i: number, by: number) => {
		const list = [...rows];
		const [row] = list.splice(i, 1);
		list.splice(i + by, 0, row);
		props.onChange(list);
	};
	return (
		<fieldset className="items">
			<legend>{field.label}</legend>
			{rows.map((row, i) => (
				<div className="item" key={row._key}>
					<div className="item-bar">
						<span>
							{field.item} {i + 1}
						</span>
						<button
							type="button"
							className="button small"
							aria-label="Omhoog"
							disabled={i === 0}
							onClick={() => move(i, -1)}
						>
							↑
						</button>
						<button
							type="button"
							className="button small"
							aria-label="Omlaag"
							disabled={i === rows.length - 1}
							onClick={() => move(i, 1)}
						>
							↓
						</button>
						<button
							type="button"
							className="button small"
							aria-label="Verwijderen"
							onClick={() => props.onChange(rows.filter((_, j) => j !== i))}
						>
							×
						</button>
					</div>
					{field.fields.map((f) => (
						<FieldInput
							key={f.name}
							field={f}
							value={row[f.name]}
							onChange={(v) => set(i, { [f.name]: v })}
						/>
					))}
				</div>
			))}
			<div>
				<button
					type="button"
					className="button small"
					onClick={() => props.onChange([...rows, { _key: newKey() }])}
				>
					{field.item} toevoegen
				</button>
			</div>
		</fieldset>
	);
}

function FieldInput(props: { field: ItemField; value: unknown; onChange: (v: unknown) => void }) {
	const { field } = props;
	const label = "required" in field && field.required ? `${field.label} *` : field.label;
	if (field.kind === "image")
		return <ImageInput label={label} value={asImage(props.value)} onChange={props.onChange} />;
	if (field.kind === "choices") {
		const chosen = asList(props.value);
		return (
			<fieldset className="choices">
				<legend>{label}</legend>
				{Object.entries(field.options).map(([value, text]) => (
					<label key={value} className="choice">
						<input
							type="checkbox"
							checked={chosen.includes(value)}
							onChange={(event) => {
								const next = event.target.checked
									? [...chosen, value]
									: chosen.filter((v) => v !== value);
								// In the options' order, and none as no value.
								const ordered = Object.keys(field.options).filter((o) => next.includes(o));
								props.onChange(ordered.length ? ordered : undefined);
							}}
						/>
						{text}
					</label>
				))}
			</fieldset>
		);
	}
	return (
		<label className="field">
			<span>{label}</span>
			{field.kind === "textarea" ? (
				<textarea
					className="input textarea"
					rows={4}
					value={asText(props.value)}
					onChange={(event) => props.onChange(event.target.value)}
				/>
			) : field.kind === "select" ? (
				<select
					className="input"
					value={asText(props.value) || Object.keys(field.options)[0]}
					onChange={(event) => props.onChange(event.target.value)}
				>
					{Object.entries(field.options).map(([value, text]) => (
						<option key={value} value={value}>
							{text}
						</option>
					))}
				</select>
			) : (
				<Input
					className="input"
					type={field.kind === "url" ? "text" : undefined}
					placeholder={field.kind === "url" ? "/pagina/ of https://…" : undefined}
					value={asText(props.value)}
					onValueChange={props.onChange}
				/>
			)}
		</label>
	);
}

// An image field: its preview and alt text, a new upload, or none.
function ImageInput(props: {
	label: string;
	value: Image | undefined;
	onChange: (v: Image | undefined) => void;
}) {
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState("");
	const choose = async (file: File) => {
		setBusy(true);
		setProblem("");
		try {
			props.onChange(await upload(file, props.value?.alt ?? ""));
		} catch (e) {
			setProblem((e as Error).message || "Uploaden is niet gelukt.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<fieldset className="image-field">
			<legend>{props.label}</legend>
			{props.value && (
				<div className="image-row">
					<img src={preview(props.value.src)} alt="" />
					<Input
						className="input"
						placeholder="Wat staat erop?"
						aria-label="Alt-tekst"
						value={props.value.alt}
						onValueChange={(alt) => props.onChange({ ...props.value!, alt })}
					/>
					<button
						type="button"
						className="button small"
						aria-label="Afbeelding weghalen"
						onClick={() => props.onChange(undefined)}
					>
						×
					</button>
				</div>
			)}
			{data.media ? (
				<input
					className="file"
					type="file"
					accept={ACCEPT}
					disabled={busy}
					aria-label={props.value ? "Andere afbeelding" : "Afbeelding kiezen"}
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (file) void choose(file);
					}}
				/>
			) : (
				!props.value && <span className="hint">Afbeeldingen staan uit op deze site.</span>
			)}
			{busy && <span className="hint">Bezig met uploaden…</span>}
			{problem && (
				<p className="problem" role="alert">
					{problem}
				</p>
			)}
		</fieldset>
	);
}

// The editor reports changes with a delay, so read its value at submit.
function EditForm() {
	const editor = useEditor();
	const field = useRef<HTMLInputElement>(null);
	return (
		<form
			method="post"
			className="edit"
			onSubmit={() => {
				field.current!.value = JSON.stringify(editor.getSnapshot().context.value ?? []);
			}}
		>
			<FormatToolbar />
			<PortableTextEditable className="editable" />
			<input type="hidden" name="value" ref={field} />
		</form>
	);
}

// The bar on top of every screen: the switcher, the page on the site, sign-out.
function Bar() {
	return (
		<header className="bar">
			<Switcher />
			{data.pagePath && (
				<a className="button" href={data.pagePath} target="_blank">
					Bekijk de pagina
				</a>
			)}
			<span className="email">{data.email}</span>
			<form method="post" action="/admin/sign-out">
				<button type="submit" className="button">
					Uitloggen
				</button>
			</form>
		</header>
	);
}

// An item's screens: its fields, then each text.
function Tabs(props: { tabs: { href: string; label: string }[] }) {
	const here = window.location.pathname;
	return (
		<nav className="tabs" aria-label="Onderdelen">
			{props.tabs.map((tab) => (
				<a key={tab.href} href={tab.href} aria-current={tab.href === here ? "page" : undefined}>
					{tab.label}
				</a>
			))}
		</nav>
	);
}

function Saved() {
	return data.saved ? (
		<span role="status" className="saved">
			Opgeslagen
		</span>
	) : null;
}

function Problem(props: { text: string }) {
	return props.text ? (
		<p className="problem" role="alert">
			{props.text}
		</p>
	) : null;
}

// A page's fields, or an item's (with its title and slug): the form built
// from the fields, posted as JSON in `value`.
function FieldsForm(props: {
	fields: readonly Field[];
	value: Record<string, unknown>;
	item?: { title: string; slug: string };
}) {
	const [value, setValue] = useState<PartValue>(props.value);
	const [title, setTitle] = useState(props.item?.title ?? "");
	const [slug, setSlug] = useState(props.item?.slug ?? "");
	const [problem, setProblem] = useState("");
	const hidden = useRef<HTMLInputElement>(null);
	return (
		<form
			method="post"
			className="fields-form"
			onSubmit={(event) => {
				const wrong =
					(props.item && title.trim() === "" ? "Vul de titel in." : "") ||
					(props.item && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
						? "Het adres mag alleen kleine letters, cijfers en streepjes bevatten."
						: "") ||
					missing(value, props.fields);
				if (wrong) {
					event.preventDefault();
					setProblem(wrong);
					return;
				}
				// Emptied fields leave the value.
				const set = Object.fromEntries(
					Object.entries(value).filter(([, v]) => v !== undefined && v !== ""),
				);
				hidden.current!.value = JSON.stringify(set);
			}}
		>
			{/* Save sits in the sticky bar, as on the text screen, so a long form needn't be scrolled. */}
			<div className="toolbar" role="toolbar" aria-label="Opslaan">
				<Problem text={problem} />
				<span className="spacer"></span>
				<Saved />
				<button type="submit" className="button primary">
					Opslaan
				</button>
			</div>
			{props.item && (
				<div className="fields">
					<label className="field">
						<span>Titel *</span>
						<Input className="input" name="title" value={title} onValueChange={setTitle} />
					</label>
					<label className="field">
						<span>Adres</span>
						<Input
							className="input"
							name="slug"
							value={slug}
							onValueChange={setSlug}
							aria-describedby="slug-hint"
						/>
						<small className="hint" id="slug-hint">
							Het laatste deel van de link naar deze pagina. Na een wijziging werkt de oude link
							niet meer.
						</small>
					</label>
				</div>
			)}
			<Fields
				fields={props.fields}
				value={value}
				onChange={(next) => setValue((current) => ({ ...current, ...next }))}
			/>
			<input type="hidden" name="value" ref={hidden} />
		</form>
	);
}

type CollectionScreen = Extract<AdminData["screen"], { kind: "collection" }>;

// A collection's items in the site's order: open, move, show or hide,
// delete (after a question), and a new one on top.
function CollectionList(props: { screen: CollectionScreen }) {
	const { screen } = props;
	const [removing, setRemoving] = useState<CollectionScreen["items"][number] | null>(null);
	const post = (href: string, fields: Record<string, string>, label: string, extra = "") => (
		<form method="post" action={href}>
			{Object.entries(fields).map(([name, value]) => (
				<input key={name} type="hidden" name={name} value={value} />
			))}
			<button type="submit" className={`button small ${extra}`}>
				{label}
			</button>
		</form>
	);
	return (
		<>
			<h1 className="screen-title">{screen.title}</h1>
			<form method="post" action={`${screen.href}new`} className="toolbar new-item">
				<Input
					className="input"
					name="title"
					required
					placeholder={`Titel van het nieuwe ${screen.item.toLowerCase()}`}
					aria-label="Titel"
				/>
				<button type="submit" className="button primary">
					{screen.item} toevoegen
				</button>
			</form>
			{screen.items.length === 0 ? (
				<p className="hint">Nog geen {screen.title.toLowerCase()}.</p>
			) : (
				<ol className="item-list">
					{screen.items.map((item, i) => (
						<li key={item.id} className={item.published ? undefined : "hidden-item"}>
							<a href={item.href} className="item-title">
								{item.title}
							</a>
							{!item.published && <span className="badge">Verborgen</span>}
							{item.published && (
								<a className="button small" href={item.path} target="_blank">
									Bekijk
								</a>
							)}
							{i > 0 && post(`${item.href}move`, { richting: "omhoog" }, "↑")}
							{i < screen.items.length - 1 && post(`${item.href}move`, { richting: "omlaag" }, "↓")}
							{post(
								`${item.href}visibility`,
								{ zichtbaar: item.published ? "0" : "1" },
								item.published ? "Verbergen" : "Tonen",
							)}
							<button type="button" className="button small" onClick={() => setRemoving(item)}>
								Verwijderen
							</button>
						</li>
					))}
				</ol>
			)}
			<Dialog.Root open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
				<Dialog.Portal>
					<Dialog.Backdrop className="backdrop" />
					<Dialog.Popup className="popup dialog">
						<Dialog.Title className="popup-title">{screen.item} verwijderen?</Dialog.Title>
						<Dialog.Description>
							{removing?.title} en de teksten ervan worden verwijderd. Dat kan niet ongedaan worden
							gemaakt.
						</Dialog.Description>
						<div className="row">
							{removing && post(`${removing.href}delete`, {}, "Verwijderen", "danger")}
							<Dialog.Close className="button">Annuleren</Dialog.Close>
						</div>
					</Dialog.Popup>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}

function Screen(props: {
	schemaDefinition: ReturnType<typeof buildSchema>;
	nodes: ReturnType<typeof buildNodes>;
}) {
	const { schemaDefinition, nodes } = props;
	const screen = data.screen;
	if (screen.kind === "text") {
		return (
			<EditorProvider
				initialConfig={{ schemaDefinition, initialValue: screen.value as PortableTextBlock[] }}
			>
				<NodePlugin nodes={nodes} />
				<Bar />
				<main>
					{screen.tabs && (
						<>
							<h1 className="screen-title">{screen.title}</h1>
							<Tabs tabs={screen.tabs} />
						</>
					)}
					<EditForm />
				</main>
				<GalleryEditor />
				<PartEditor />
			</EditorProvider>
		);
	}
	return (
		<>
			<Bar />
			<main className="form-screen">
				{screen.kind === "fields" && (
					<>
						<h1 className="screen-title">{screen.title}</h1>
						<FieldsForm fields={screen.fields} value={screen.value} />
					</>
				)}
				{screen.kind === "item" && (
					<>
						<a className="back" href={screen.back.href}>
							← {screen.back.label}
						</a>
						<h1 className="screen-title">{screen.title}</h1>
						<Tabs tabs={screen.tabs} />
						<FieldsForm
							fields={screen.fields}
							value={screen.value}
							item={{ title: screen.title, slug: screen.slug }}
						/>
					</>
				)}
				{screen.kind === "collection" && <CollectionList screen={screen} />}
			</main>
		</>
	);
}
