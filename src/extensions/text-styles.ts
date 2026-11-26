// Example text styles. A site picks the ones it wants under its own keys
// (the keys are stored in the texts):
//
//   textStyles: { decorators: { highlight, footnote }, blockStyles: { lead }, linkStyles: { button } }
//
// The classes come from the site's stylesheet: define .highlight, .footnote
// and .lead there (the starter's app.css has them).

// Selected words in the brand colour's highlight (smart-impact's green).
export const highlight = { label: "Markeren", tag: "mark", class: "highlight" };

// A footnote marker after a word: superscript, linked by the site's CSS.
export const footnote = { label: "Voetnoot", tag: "sup", class: "footnote" };

// A larger opening paragraph.
export const lead = { label: "Intro", tag: "p", class: "lead" };

// A link that looks like the site's primary button.
export const button = { label: "Knop", class: "btn btn-primary" };
