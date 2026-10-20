---
name: screenbook
description: Draw a product's screens in its Screenbook (the shared canvas people review in the browser), keep them there across missions, and answer the comments that mention you. Use when the user says "/screenbook", asks to design, mock up or change a screen of a product that has a screenbook, wants the mockups of an RFC to live with the product, or when the screenbook watcher wakes you up with a mention.
---

# Screenbook

A screenbook is one canvas per product. Every screen you draw lands there, people comment on the exact piece of a screen, mark `@claude`, and approve. You work from the chat that is already open; nothing in the screenbook thinks on its own.

## 1. Connect

You need the `screenbook` tools (`open_project`, `read_screen`, `write_screen`, `write_part`, `screenshot`, `link_screens`, `reply_comment`, `resolve_comment`, `annotate`, `remove_annotation`, `approve`, `archive`, `restore`, `share`). If they are missing, give the user this line and stop. If only `annotate`, `remove_annotation` or `resolve_comment` are missing, the MCP is an older copy: run the same line again and reopen the chat.

```
npx -y github:arvoreeducacao/screenbook install --store <store> --viewer <viewer url>
```

It copies this skill into the project and registers the MCP, replacing any older registration. If `open_project` has no `product` parameter while the store holds several products, an older registration is pinning the MCP to one folder: run the same `install` again and reopen the chat. `<viewer url>` is where people open the canvas; with it, the canvas shows where you are working. `<store>` is where the screenbooks live: usually the server itself (`https://…`, the same address as the viewer), or `s3://bucket/prefix` or `dir:./path`. A `github:` store is legacy: if you see one, run `install` again with the server address. If you do not know it, ask; never invent one.

A store can hold one product, or one folder per product. With folders, every tool takes a `product` (the folder name), `open_project` without one lists the products, and `create_project` makes a new one. Pick the product the screens belong to; if none fits, ask before creating one, and when you create it pass `head_html` with the fonts and CSS variables of its real theme so its screens look like it. People can also create a product from the viewer's home.

## 2. Open the product

Call `open_project` (with `product` when the store has several). It lists `layout` (sections in order, one line per screen with its id, number, name, official and latest version and route; variations right under their screen), open proposals, the ids of archived screens, and `pending`. In a big product (more than 120 screens) each section lists only ids: call `open_project` again with `section` to get that section in full: comments that mention you and still have no answer. Answer the pending ones before anything else.

Then sweep the open proposals. Whoever drew a proposal is rarely around when its PR is merged, so the approval is left to whoever opens the product next: you.

1. For each open proposal, find the PRs that link it: `gh search prs --owner <org> "proposal=<id>" --json repository,number,state,title`.
2. No merged PR: leave it open.
3. Merged PR: read its description to learn which screens and which option were built. Approve those screens one by one, with the PR in `reason`. Archive the options that lost. Screens the PR says were left for later stay open.
4. Tell the user in one line what you approved and archived, and which proposals are still waiting for code.

Call `approve` and `archive` one at a time, never in parallel: concurrent writes to the same proposal overwrite each other and an approval silently disappears. Check the `approved` list each call returns.

## 3. Leave the listener running

Start the watcher in the background so a mention made in the browser wakes this chat:

```
npx -y github:arvoreeducacao/screenbook watch --store <store> --handle claude
```

Add `--product <folder>` to listen to one product only; without it the watcher covers every product and says which one each mention came from. It prints one line on stderr once it has looked at the store and is listening (`screenbook: listening for @claude on …`); wait for that line, then tell the user once that you are listening. A mention is printed only after two looks in a row see it unanswered, so one you just answered does not come back.

- **With the Monitor tool** (Claude Code): add `--follow`. It never exits and prints one JSON line per new mention, each mention once per run, and every line wakes you.
- **Without it**: run it with `run_in_background`. It prints the waiting mentions and exits `0` (exit `2` only happens with `--timeout`). Handle what it printed, then start it again.

Stop listening when the user says so.

## 4. Answer a mention

1. `read_screen` the screen named in the mention, at the version it points to.
2. Change what was asked with `write_screen`, inside the proposal that version belongs to. A mention on an official screen opens a new proposal named after the request.
3. Look at the screenshot `write_screen` returns. If it is wrong, fix it before answering. Never say it is done without having looked.
4. `reply_comment` on the mention's comment, saying in one or two sentences what changed and which version to open.
5. `resolve_comment` on that conversation, so its pin leaves the canvas. Never resolve a conversation whose change you did not make; if you only discussed or asked, leave it open.

A comment can be about several pieces at once: `els` lists them, in the order the person picked. Change all of them, and say so in the reply.

People also change screens themselves in the browser: they edit pieces (text, colors, size) or duplicate a screen as a variation. Those versions have the person's name in `by`. Always `read_screen` the latest version before drawing on top of it, so you keep what they did.

Every screen has a number, shown on the canvas next to its name (the `#number` in each line of `layout`). When you talk about screens, in a reply or in the chat, call them by it: "screen 3, v2". Never invent letters or labels people cannot find on the canvas.

## 5. Drawing

- One proposal per mission. Its id is a short slug (`checkout-redesign`), its title the question it answers.
- New screens need `name` and `section`; existing ones are addressed by id and keep their history.
- Place every new screen where it belongs in the flow, never just at the end: pass `after` with the id of the screen it follows in its section (or `"start"`). `open_project` returns `layout`, the canvas as it is: sections in order, screens left to right, variations under each one.
- A state of a screen (empty, loading, error, with or without some piece, another role) is a variation of it, not a new screen of the flow. Draw it with `variant_of` set to the base screen: the canvas stacks it below that screen, in its section. A tall screen (a landing page, a long scrolling page, anything taller than about three times its width) keeps its variations side by side instead, so the canvas does not become one endless column; the canvas does this on its own. Name it with the base name first and the difference after it: "Order list", "Order list · empty", "Order list · filtered". Duplicating a screen in the browser already makes a variation of it.
- When a person asks to reorganize the canvas, or a section has grown out of order, call `arrange` with the sections in the order of the product and each one's screens in the order of the flow, variations nested under their base. Listing one section reorders only that section. Screen numbers never change, so people's references stay valid.
- Plain HTML. If the project has a shared `head.html` (fonts, CSS variables), it is added around your HTML; use its variables. If there is none, put the product's styles inline in the screen.
- Pieces that repeat across screens (sidebar, top bar) are parts: save one with `write_part` and write `<sb-part name="sidebar"></sb-part>` where it goes. `open_project` lists the parts that exist; use them instead of copying.
- Small fix: pass `edits` (`old_string`/`new_string`) instead of resending the whole html.
- Fixing your own draft that nobody commented on yet: pass `amend: true`, so the broken try does not stay in the history people review. Once someone commented on a version, draw a new one.
- Put `data-el="stable-name"` on every piece people may comment on: buttons, fields, cards, rows, notices. The name describes the piece (`place-order`), never its look, and never changes between versions; comments are pinned to it.
- Desktop is 1280×800 by default. For phone screens pass `width: 375, height: 812`, and use `screenshot` with `mobile: true` to check a desktop screen at phone width.
- Realistic made-up data in the product's language. Never real names of people or customers, tokens or production data.
- When a piece leads to another screen, record it with `link_screens` so the flow map shows the path.
- Never write explanations inside the screen HTML: no dashed boxes, captions, "note:" blocks or arrows drawn into the drawing. The screen shows only what the product would show. Everything you want to say about it goes in `annotate`.

## 5a. Annotating

`annotate` leaves a note beside the screen, outside the drawing, like a Dev Mode annotation: a small collapsed card next to the frame, tied to the piece by a dashed line. People hover it to see the piece and click it to read.

- One note per idea, about one piece: pass the piece's `data-el` as `el`, or leave it out for the whole screen.
- The first line is what shows collapsed, so make it the point ("Option A: the store owns the QR code"). Details go on the next lines; `**bold**` and line breaks are kept.
- `category` is the label on the card: `Decision`, `Open`, `Risk`, `Source`, or another short word. Without it the card shows the default AI note label.
- `version` defaults to the latest; pass it when the note is about an older one.
- Annotations never mention anyone and never wait for an answer; to ask a person something, ask in the chat. `read_screen` lists them under `annotations`, apart from people's `comments`.
- When a note stops being true (the screen changed, the question was decided), `remove_annotation` it by id, or add a new one saying what changed.

## 6. Approving and archiving

The canvas shows what the product is. Official means the screen is live exactly as drawn.

- `approve` a proposal, or one screen of it, when what it draws is live in the product (merged to main and deployed), or when the person asked you to in this chat. `reason` says what proves it: the route and the PR, or who asked. A screen that is live but differs from the drawing gets a new version first, then the approval.
- `archive` a screen that is not in the product and nobody is building, and an open proposal nobody is going to build. Nothing is deleted: `open_project` lists it under `archived`, and `restore` brings it back.
- After a mission ships, approve its proposal and archive the options that lost, so the canvas does not keep alternatives as if they were the product.
- When you open the PR that builds a proposal, put the proposal link in its description (`Screens: <viewer>/<product>/?proposal=<id>`) and say which screens, by number, it builds and which it leaves for later. That line is how the next chat finds the proposal and knows what to approve once the PR is merged.

## 7. Sharing outside the repository

`share` opens a public link to one proposal, for someone who cannot sign in (a client, a partner, someone from another team). For 30 days, whoever has it sees that proposal's screens and comments by typing a name, without signing in. Their comments never mention you; read them with `read_screen`. Open a link only when a person in this chat asks for one, and hand them the `link` it returns. People revoke links from the viewer's sidebar.

## 8. What you never do

- Open a public link nobody asked for.
- Approve something that is not live, or that nobody asked you to approve, because it looks finished.
- Delete screens or rewrite someone else's proposal without being asked.
- Draw outside a proposal. `write_screen` refuses it anyway.

## 9. From an RFC

When an RFC needs screens, draw them in a proposal of the product's screenbook instead of a one-off canvas. Name the proposal after the mission, put the question it decides in its title, and draw the options as separate screens or versions. Link the proposal wherever the mission is discussed: the viewer opens straight on it with `?proposal=<id>` (for a store with product folders, `/<product>/?proposal=<id>`). The screens stay with the product after the mission ends.
