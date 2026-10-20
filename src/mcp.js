import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { Book, MOBILE, slug } from "./book.js";
import { bookOn, createProduct, isMulti, listProducts, productBooks } from "./products.js";
import { inspect, screenshot } from "./render.js";
import { splitAnnotations } from "../viewer/annotations.js";
import { arrange } from "../viewer/arrange.js";
import { presenceSender } from "./presence.js";

function text(value) {
  return { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) };
}

function image(png) {
  return { type: "image", data: png.toString("base64"), mimeType: "image/png" };
}

function failure(error) {
  return { isError: true, content: [text(error.message)] };
}

function guarded(handler) {
  return async (input) => {
    try {
      return await handler(input);
    } catch (error) {
      return failure(error);
    }
  };
}

let presenceChain = Promise.resolve();

const FULL_LAYOUT_SCREENS = 120;
const TOOL_ANSWER_LIMIT = 28000;

export function fit(value, limit = TOOL_ANSWER_LIMIT) {
  let json = JSON.stringify(value);
  if (json.length <= limit) return value;
  const copy = structuredClone(value);
  const lists = (node, out = []) => {
    if (Array.isArray(node)) out.push(node);
    if (node && typeof node === "object") for (const child of Object.values(node)) lists(child, out);
    return out;
  };
  for (let round = 0; round < 40 && json.length > limit; round += 1) {
    const longest = lists(copy).sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
    if (!longest || longest.length <= 1) break;
    longest.splice(Math.ceil(longest.length * 0.7));
    json = JSON.stringify(copy);
  }
  if (json.length > limit) return { truncated: true, json: json.slice(0, limit) };
  return { ...copy, truncated: true };
}

export function buildTools(
  book,
  { handle = "claude", render = screenshot, read = inspect, presence = (activity) => book.setPresence(handle, activity), shareLink = (token) => `/s/${token}/`, ask = false } = {},
) {
  function announce(activity) {
    if (!presence) return;
    presenceChain = presenceChain.then(() => presence(activity)).catch(() => {});
  }

  async function shoot(id, version, mobile) {
    const meta = await book.screen(id);
    const entry = meta.versions.find((item) => item.v === version);
    if (!entry) throw new Error(`screen "${id}" has no version ${version}`);
    const size = mobile ? MOBILE : { width: entry.width, height: entry.height };
    const png = await render(await book.composedHtml(id, version), size);
    if (!mobile) await book.savePng(id, version, png);
    return png;
  }

  function pickVersion(meta, version) {
    return version ?? meta.official ?? book.latest(meta);
  }

  const tools = {
    open_project: {
      description:
        "Open the screenbook: its sections, every screen with its official and latest version, open proposals, and the comments mentioning you that still wait for an answer. Start here. In a big product the sections list only screen ids: pass section to see one section in full.",
      input: {
        section: z.string().optional().describe("a section name or id: lists only that section, with every screen's name and versions"),
      },
      async run({ section: only } = {}) {
        announce({ action: "looking" });
        const { notes, project, screens, proposals, archived, flows, ...rest } = await book.overview(handle);
        const line = (screen) =>
          `${screen.id} #${screen.number} ${screen.name} | official ${screen.official ? `v${screen.official}` : "none"} | latest v${screen.versions.at(-1)?.v ?? 0}${screen.route ? ` | ${screen.route}` : ""}`;
        const wanted = only ? slug(only) : null;
        const full = Boolean(wanted) || screens.length <= FULL_LAYOUT_SCREENS;
        const layout = arrange(project.sections, screens)
          .filter(({ section }) => !wanted || section.id === wanted || slug(section.name) === wanted)
          .map(({ section, groups }) => ({
            section: section.name,
            ...(full
              ? { screens: groups.flatMap((group) => [line(group.screen), ...group.variants.map((variant) => `  variant of ${group.screen.id}: ${line(variant)}`)]) }
              : { count: groups.reduce((total, group) => total + 1 + group.variants.length, 0), ids: groups.flatMap((group) => [group.screen.id, ...group.variants.map((variant) => variant.id)]) }),
          }));
        if (wanted && !layout.length) throw new Error(`no section "${only}"; sections: ${project.sections.map((item) => item.name).join(", ")}`);
        return {
          content: [
            text(
              JSON.stringify({
                handle: `@${handle}`,
                store: book.store.describe(),
                project: { name: project.name, ...(project.head ? { head: project.head } : {}) },
                screenFormat: full
                  ? "id #number name | official version | latest version | route"
                  : "big product: each section lists only ids; call open_project with section to get names, numbers and versions",
                layout,
                proposals: proposals.filter((record) => record.status === "open"),
                closedProposals: proposals.length - proposals.filter((record) => record.status === "open").length,
                archived: archived.map((screen) => screen.id),
                links: flows.length,
                ...rest,
                more: "read_screen gives a screen's HTML, versions, comments and picture",
              }),
            ),
          ],
        };
      },
    },

    read_screen: {
      description:
        "Read one screen: its HTML, metadata, people's comments, your annotations (listed apart, with any replies to them), and the screenshot of that version when there is one. Defaults to the official version, or the latest one if nothing was approved yet.",
      input: {
        screen: z.string().describe("screen id, as listed by open_project"),
        version: z.number().int().positive().optional(),
      },
      async run({ screen, version }) {
        const meta = await book.screen(screen);
        const chosen = pickVersion(meta, version);
        announce({ action: "reading", screen, version: chosen });
        const [html, notes, png] = await Promise.all([
          book.screenHtml(screen, chosen),
          book.comments(screen),
          book.png(screen, chosen),
        ]);
        const { comments, annotations } = splitAnnotations(notes);
        const conversations = comments.map((entry) => (entry.replyTo ? entry : { ...entry, resolved: entry.resolved ?? null }));
        const content = [text({ meta, version: chosen, comments: conversations, annotations }), text(html)];
        if (png) content.push(image(png));
        return { content };
      },
    },

    read_guide: {
      description:
        "Read this product's guide: what people taught the AI about drawing it (visual patterns, tone, decisions that were approved, things that were refused), plus what happened on the canvas since it was last updated (approvals, archived options, people's comments on screens the AI drew). Fold those lessons into the guide with write_guide.",
      input: {},
      async run() {
        announce({ action: "looking" });
        const guide = await book.guide();
        const lessons = await book.lessons(guide.updatedAt);
        return { content: [text({ guide: guide.text || "(empty: nobody taught anything yet)", updatedBy: guide.updatedBy, updatedAt: guide.updatedAt, recentChanges: guide.changes.slice(0, 5), lessonsSinceUpdate: lessons })] };
      },
    },

    write_guide: {
      description:
        "Update this product's guide, the memory every future request reads first. Write short markdown rules under a few headings (## Visual, ## Tone, ## Approved, ## Refused, ## Open), one line each, concrete enough to apply (\"cards use radius 12 and the --surface token\", \"never a colored stripe on one side of a card: refused by alice on 20/10\"). Merge with what is there instead of piling up; keep it under 12000 characters. Pass edits to change a few lines, or text to replace it whole. Say in change what you learned and from whom.",
      input: {
        text: z.string().optional().describe("the whole guide, markdown"),
        edits: z.array(z.object({ old_string: z.string(), new_string: z.string() })).optional().describe("replacements in the current guide; each old_string must appear exactly once"),
        change: z.string().describe("one line: what changed and why, e.g. learned from alice's refusal of the side stripe"),
      },
      async run({ text: body, edits, change }) {
        announce({ action: "learning" });
        const record = await book.writeGuide({ text: body, edits, change, by: handle });
        return { content: [text({ saved: true, length: record.text.length, updatedAt: record.updatedAt })] };
      },
    },

    inspect_screen: {
      description:
        "Measure a screen the way the browser renders it. Without el: the design tokens it uses with their values, its colors and type scale by frequency, and every data-el piece with its box. With el (a data-el name or a CSS selector): that piece's computed styles, the tokens and CSS rules behind it, its text, and its children. Use it to copy the exact look of an existing screen before drawing a new one.",
      input: {
        screen: z.string().describe("screen id, as listed by open_project"),
        version: z.number().int().positive().optional(),
        el: z.string().optional().describe("data-el of the piece, or a CSS selector"),
      },
      async run({ screen, version, el }) {
        const meta = await book.screen(screen);
        const chosen = pickVersion(meta, version);
        const entry = meta.versions.find((item) => item.v === chosen);
        announce({ action: "inspecting", screen, version: chosen, el });
        const found = await read(await book.composedHtml(screen, chosen), { width: entry?.width ?? 1280, height: entry?.height ?? 800, el: el ?? null });
        return { content: [text(JSON.stringify(fit({ screen, version: chosen, ...found })))] };
      },
    },

    find_screens: {
      description:
        "Find the screens of this product that look like what you are about to draw: by words (what the screen shows, its route, the names of its pieces) or like another screen. Returns the best matches with their section, route, pieces and a line of their text. Read or inspect the closest one before drawing, so the new screen looks like its neighbors.",
      input: {
        query: z.string().optional().describe("words, e.g. order list status filter"),
        like: z.string().optional().describe("a screen id: finds the screens closest to it"),
        limit: z.number().int().positive().max(20).optional(),
      },
      async run({ query, like, limit = 8 }) {
        announce({ action: "searching", ...(like ? { screen: like } : {}) });
        return { content: [text(JSON.stringify(fit({ matches: await book.searchScreens({ query: query ?? "", like: like ?? null, limit }) })))] };
      },
    },

    read_proposal: {
      description:
        "Read a whole proposal at once: its screens with their versions and status, and every conversation and annotation on them (open ones first), with each reply. Use it before applying comments or reviewing a proposal.",
      input: {
        proposal: z.string().describe("proposal id, as listed by open_project"),
      },
      async run({ proposal }) {
        announce({ action: "reading", proposal: slug(proposal) });
        return { content: [text(JSON.stringify(fit(await book.proposalThreads(proposal))))] };
      },
    },

    write_screen: {
      description:
        "Draw a screen, or a new version of one, inside a proposal. Write plain HTML (a fragment or a full document); the project's shared head.html, if any, is added around it, and every <sb-part name=\"x\"></sb-part> is replaced by that shared part. Give every piece people may comment on a stable data-el name. To change a few lines, pass edits instead of html: they apply to the latest version. To fix your own draft before anyone commented on it, pass amend: true and the latest version is overwritten instead of a new one being added. Returns the screenshot so you can check what you drew.",
      input: {
        proposal: z.string().describe("the mission this drawing belongs to, e.g. checkout-redesign; created if new"),
        proposal_title: z.string().optional().describe("human title for a new proposal"),
        screen: z.string().optional().describe("id of an existing screen, or of the new one"),
        name: z.string().optional().describe("human name, required for a new screen"),
        section: z.string().optional().describe("section of the product, required for a new screen"),
        route: z.string().optional(),
        html: z.string().optional().describe("the whole screen; leave out when passing edits"),
        edits: z
          .array(z.object({ old_string: z.string(), new_string: z.string() }))
          .optional()
          .describe("replacements applied to the latest version; each old_string must appear exactly once"),
        amend: z.boolean().optional().describe("overwrite the latest version (same proposal, not official, no comments on it) instead of adding one"),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        after: z.string().optional().describe('id of the screen this one goes right after in its section, or "start"; without it a new screen goes at the end'),
        variant_of: z.string().optional().describe("id of the screen this one is a state or variation of (empty, error, with or without a piece); it is stacked below that screen, in its section"),
      },
      async run(input) {
        announce({
          action: "drawing",
          screen: slug(input.screen ?? input.name ?? ""),
          name: input.name,
          proposal: slug(input.proposal ?? ""),
          ...(input.section ? { section: slug(input.section) } : {}),
          ...(input.variant_of ? { variantOf: slug(input.variant_of) } : {}),
          ...(input.after ? { after: slug(input.after) } : {}),
        });
        const saved = await book.writeScreen({
          ...input,
          proposalTitle: input.proposal_title,
          variantOf: input.variant_of,
          by: handle,
        });
        const png = await shoot(saved.screen, saved.version, false);
        announce({ action: "drew", screen: saved.screen, version: saved.version, proposal: saved.proposal });
        return { content: [text(saved), image(png)] };
      },
    },

    arrange: {
      description:
        "Reorder the canvas: the order of sections, the order of screens in each section (left to right), and which screens are variations stacked below another. List sections in canvas order; each one lists its screens in order, a screen with variations as { id, variants: [ids] }. A screen listed moves to that section; a top-level entry stops being a variation. The listed sections take the place of the first of them, in the order given, so listing one section only reorders its screens and listing all of them reorders the whole canvas. Screens left out of a listed section stay after the listed ones. Screen numbers never change.",
      input: {
        sections: z
          .array(
            z.object({
              name: z.string().describe("section name; created if new"),
              screens: z
                .array(z.union([z.string(), z.object({ id: z.string(), variants: z.array(z.string()).optional() })]))
                .optional(),
            }),
          )
          .min(1),
      },
      async run({ sections }) {
        announce({ action: "arranging" });
        return { content: [text(await book.arrange({ sections, by: handle }))] };
      },
    },

    read_board: {
      description:
        "Read a board (a whiteboard page of this product): its sticky notes, shapes, text, connectors, sections, stamps, drawings and screen cards, each with id, type, box [x, y, w, h], text and color, and the id of the section it sits in. Connectors give from/to item ids. Without page, lists the boards. Big boards come cut to fit: pass section (a section id) or near [x, y, w, h] to read one part.",
      input: {
        page: z.string().optional().describe("board page id or name; leave out to list the boards"),
        section: z.string().optional().describe("read only this section and what is inside it"),
        near: z.array(z.number()).length(4).optional().describe("read only what overlaps this box [x, y, w, h]"),
      },
      async run({ page, section, near }) {
        if (!page) return { content: [text({ boards: await book.boards(), next: "call read_board with a page, or create_board to start one" })] };
        const summary = await book.boardSummary({ page, section, near });
        const box = summary.bounds;
        announce({ action: "reading", page: summary.page, ...(box ? { boardX: (box[0] + box[2]) / 2, boardY: (box[1] + box[3]) / 2 } : {}) });
        return { content: [text(fit(summary))] };
      },
    },

    create_board: {
      description: "Create a new board page in this product (a whiteboard for brainstorms, flows and notes, next to the pages of screens). Returns its page id for write_board.",
      input: { name: z.string().describe("page name, e.g. Brainstorm onboarding") },
      async run({ name }) {
        const made = await book.createPage({ name, kind: "board", by: handle });
        announce({ action: "drawing", page: made.id, boardX: 0, boardY: 0 });
        return { content: [text({ page: made.id, name: made.name, next: "call write_board with this page" })] };
      },
    },

    write_board: {
      description:
        "Change a board with a list of ops, applied in order, one at a time on the server, so people editing the same board at once never lose a change. Everyone looking at the board sees it live. Ops:\n" +
        "- add: { op: 'add', ref?, item: { type, x?, y?, w?, h?, text?, color?, ... } }. Types: sticky (200x200 note), shape (shape: rect|ellipse|diamond, text inside), text (loose text, size in px), section (a titled frame that groups what sits inside it; text is its name), stamp (stamp: plus1|heart|check), screen (a card that opens a real screen: screen id, optional version), connector (from/to item ids or refs, text = label, end: arrow|none), path (points [[x,y],...] relative to x,y; marker: true for highlighter). Leave x and y out and items are laid in rows to the right of what is on the board. ref names the new item so later ops in the same call can use it in from, to, id or ids.\n" +
        "- update: { op: 'update', id, set: { text?, color?, x?, y?, w?, h?, shape?, ... } }\n" +
        "- move: { op: 'move', id, x, y } or { op: 'move', id, dx, dy }\n" +
        "- connect: { op: 'connect', from, to, text? } draws an arrow between two items; it follows them when they move.\n" +
        "- group: { op: 'group', name, ids, color?, x?, y? } makes a section named name and lays those items in a grid inside it (use it to cluster notes by theme).\n" +
        "- delete: { op: 'delete', id } (connectors to it go too); front / back: { op, id } changes stacking.\n" +
        "Colors for sticky, shape and section: yellow, orange, pink, violet, blue, teal, green, gray; for text, connector and path: ink, red, orange, green, blue, violet. For a user flow, draw one shape per step left to right about 260px apart (ellipse for start and end, diamond for a decision, rect for a screen or action) and connect them; label decision branches. To turn a flow into real screens, draw them with write_screen in one proposal, then add screen cards next to the steps.",
      input: {
        page: z.string().describe("board page id or name, from read_board"),
        ops: z.array(z.record(z.any())).min(1).max(400),
      },
      async run({ page, ops }) {
        const first = ops.find((op) => op?.op === "add" && Number.isFinite(op.item?.x)) ?? ops.find((op) => Number.isFinite(op?.x));
        const spot = first ? { boardX: (first.item ?? first).x, boardY: (first.item ?? first).y } : {};
        announce({ action: "drawing", page, ...spot });
        const result = await book.applyBoard({ page, ops, by: handle });
        const added = result.ops.filter((op) => op.op === "add").map((op) => op.item);
        const last = added.at(-1);
        if (last && Number.isFinite(last.x)) announce({ action: "drew", page: result.page, boardX: last.x + (last.w ?? 0) / 2, boardY: last.y + (last.h ?? 0) / 2 });
        return {
          content: [
            text(
              fit({
                page: result.page,
                rev: result.rev,
                added: added.map((item) => ({ id: item.id, type: item.type, ...(item.text ? { text: item.text.slice(0, 60) } : {}), ...(Number.isFinite(item.x) ? { at: [Math.round(item.x), Math.round(item.y)] } : {}) })),
                changed: result.ops.filter((op) => op.op === "update").length,
                deleted: result.ops.filter((op) => op.op === "delete").map((op) => op.id),
                refs: result.refs,
              }),
            ),
          ],
        };
      },
    },

    screenshot: {
      description: "Take the screenshot of a screen version, at its own size or at phone width, to check how it looks.",
      input: {
        screen: z.string(),
        version: z.number().int().positive().optional(),
        mobile: z.boolean().optional(),
      },
      async run({ screen, version, mobile = false }) {
        const meta = await book.screen(screen);
        const chosen = pickVersion(meta, version);
        announce({ action: "checking", screen, version: chosen });
        const png = await shoot(screen, chosen, mobile);
        return { content: [text({ screen, version: chosen, mobile }), image(png)] };
      },
    },

    write_part: {
      description:
        "Save a piece shared by several screens of this product, like the sidebar or the top bar. Screens use it with <sb-part name=\"sidebar\"></sb-part>, which is replaced by the part when the screen is written; versions already drawn keep what they had.",
      input: {
        name: z.string().describe("e.g. sidebar"),
        html: z.string(),
      },
      async run({ name, html }) {
        return { content: [text(await book.writePart(name, html))] };
      },
    },

    link_screens: {
      description: "Record that a piece of one screen (its data-el) leads to another screen. This is what draws the flow map.",
      input: {
        from: z.string(),
        el: z.string().optional().describe("data-el of the piece that leads away"),
        to: z.string(),
        label: z.string().optional(),
      },
      async run(input) {
        announce({ action: "linking", screen: input.from });
        return { content: [text(await book.link(input))] };
      },
    },

    approve: {
      description:
        "Approve a proposal, or one of its screens, in your own name: its versions become the official ones. Approve only what is live in the product exactly as drawn, or what a person told you to approve in this chat. Say in reason what proves it (the route and the PR, or who asked).",
      input: {
        proposal: z.string().describe("proposal id, as listed by open_project"),
        screen: z.string().optional().describe("approve only this screen of the proposal"),
        reason: z.string().min(1).describe("what proves it, e.g. live at /orders since PR #1123"),
      },
      async run({ proposal, screen, reason }) {
        announce({ action: "approving", proposal: slug(proposal), screen });
        const record = await book.approve(proposal, handle, screen ?? null, reason);
        return { content: [text({ proposal: record.id, status: record.status, approved: Object.keys(book.approvals(record)) })] };
      },
    },

    archive: {
      description:
        "Take a screen or an open proposal off the canvas without deleting anything: a screen that is not in the product, a proposal nobody is going to build. Its versions and comments stay, open_project lists it under archived, restore brings it back, and drawing a new version of an archived screen brings it back too.",
      input: {
        screen: z.string().optional(),
        proposal: z.string().optional(),
        reason: z.string().min(1).describe("why it leaves the canvas, in one sentence"),
      },
      async run({ screen, proposal, reason }) {
        if (!reason.trim()) throw new Error("say why it leaves the canvas: pass reason");
        announce({ action: "archiving", screen, proposal });
        return { content: [text(await book.archive({ screen: screen ?? null, proposal: proposal ?? null, by: handle, reason }))] };
      },
    },

    restore: {
      description: "Put an archived screen or proposal back on the canvas.",
      input: {
        screen: z.string().optional(),
        proposal: z.string().optional(),
      },
      async run({ screen, proposal }) {
        return { content: [text(await book.restore({ screen: screen ?? null, proposal: proposal ?? null }))] };
      },
    },

    share: {
      description:
        "Open a public link to one proposal, for people outside the screenbook's repository: whoever has it sees that proposal's screens and comments on them by name, without signing in, for 30 days. Their comments never mention you. Share only when a person in this chat asked for the link.",
      input: {
        proposal: z.string().describe("proposal id, as listed by open_project"),
      },
      async run({ proposal }) {
        const entry = await book.share({ proposal, by: handle });
        return { content: [text({ proposal: entry.proposal, link: shareLink(entry.token), expiresAt: entry.expiresAt })] };
      },
    },

    reply_comment: {
      description:
        "Answer a comment on the canvas, as yourself. Answering a comment that mentioned you is what marks the mention as handled. Pass version to point people at the version you just drew.",
      input: {
        comment: z.string().describe("comment id"),
        text: z.string(),
        version: z.number().int().positive().optional(),
      },
      async run({ comment, text: body, version }) {
        const entry = await book.reply({ comment, text: body, author: handle, version });
        announce({ action: "replying", screen: entry.screen, version: entry.version });
        const root = await book.findComment(entry.replyTo);
        return { content: [text({ ...entry, resolved: root.resolved ?? null })] };
      },
    },

    resolve_comment: {
      description:
        "Close a conversation on the canvas once the change it asked for is drawn and you replied saying so: its pin leaves the canvas and it stops counting. Never resolve a conversation whose change was not made. A person's new reply opens it again; pass reopen: true to open it yourself. Annotations are not resolved.",
      input: {
        comment: z.string().describe("id of the conversation's first comment, or of any reply in it"),
        reopen: z.boolean().optional().describe("open a resolved conversation again"),
      },
      async run({ comment, reopen = false }) {
        return { content: [text(await book.resolve({ comment, by: handle, reopen }))] };
      },
    },

    annotate: {
      description:
        "Leave a note beside a screen, outside the drawing: why a choice was made, what is still open, a risk, where a number came from. It shows on the canvas as a collapsed card next to the screen, tied to the piece by a dashed line, and people expand it to read. Never write explanations inside the screen HTML; use this instead. An annotation never mentions anyone and never waits for an answer.",
      input: {
        screen: z.string().describe("screen id, as listed by open_project"),
        el: z.string().optional().describe("data-el of the piece the note is about; leave out for the whole screen"),
        text: z.string().min(1).describe("the note; the first line is what shows collapsed, **bold** and line breaks are kept"),
        category: z.string().optional().describe("short label shown on the card, e.g. Decision, Open, Risk, Source"),
        version: z.number().int().positive().optional().describe("version the note is about; defaults to the latest"),
      },
      async run({ screen, el, text: body, category, version }) {
        const entry = await book.annotate({ screen, el, text: body, category, version, author: handle });
        announce({ action: "annotating", screen: entry.screen, version: entry.version });
        return { content: [text(entry)] };
      },
    },

    remove_annotation: {
      description: "Remove one of the annotations beside a screen, with any replies to it, when it is wrong or no longer true. Only annotations can be removed; people's comments stay.",
      input: {
        id: z.string().describe("annotation id, as listed by read_screen under annotations"),
      },
      async run({ id }) {
        return { content: [text(await book.removeAnnotation({ id, by: handle }))] };
      },
    },
  };

  if (ask) {
    tools.ask_person = {
      description:
        "Ask the person in this chat one question before acting, when the answer changes the drawing a lot and you cannot find it on the canvas or in the guide. Give 2 to 4 short options; the person can also type their own. After calling this, stop: write nothing else and end your turn. Their answer comes as the next message.",
      input: {
        question: z.string().describe("one short question, in the language the person writes in"),
        options: z.array(z.string()).min(2).max(4).describe("short answers to choose from"),
      },
      async run({ question, options }) {
        announce({ action: "asking" });
        return { content: [text({ asked: question, options, next: "stop here and wait: the person's answer comes as the next message" })] };
      },
    };
  }
  return Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, { ...tool, run: (input) => book.saving(null, () => tool.run(input)) }]));
}

export function buildProductTools(
  store,
  { handle = "claude", render = screenshot, presenceFor = (book) => (activity) => book.setPresence(handle, activity), viewer = "", ask = false } = {},
) {
  const bookFor = productBooks(store);
  const template = buildTools(new Book(store), { handle, render, presence: null, ask });
  const product = z.string().describe("product folder, as listed by open_project without a product (e.g. storefront)");
  const tools = {};
  for (const [name, tool] of Object.entries(template)) {
    tools[name] = {
      description: tool.description,
      input: { product: name === "open_project" ? product.optional() : product, ...tool.input },
      async run({ product: chosen, ...rest }) {
        if (name === "open_project" && !chosen) {
          return { content: [text({ store: store.describe(), products: await listProducts(store), next: "call open_project again with one product" })] };
        }
        const book = await bookFor(chosen);
        const shareLink = (token) => `${viewer}/${chosen}/s/${token}/`;
        return buildTools(book, { handle, render, presence: presenceFor(book, chosen), shareLink, ask })[name].run(rest);
      },
    };
  }
  tools.create_project = {
    description:
      "Create a new product in this screenbook, with its own folder and canvas. Pass head_html with the product's fonts and CSS variables (taken from its real theme) so every screen drawn in it looks like the product.",
    input: {
      name: z.string().describe("human name, e.g. Acme Store"),
      id: z.string().optional().describe("folder name; defaults to the name in kebab-case"),
      head_html: z.string().optional().describe("shared <link>/<style> added around every screen of this product"),
    },
    async run({ name, id, head_html }) {
      const created = await createProduct(store, { name, id, head: head_html });
      return { content: [text({ ...created, next: `call open_project with product "${created.id}"` })] };
    },
  };
  return tools;
}

export async function skillText() {
  const raw = await readFile(new URL("../skills/screenbook/SKILL.md", import.meta.url), "utf8").catch(() => "");
  return raw.replace(/^---[\s\S]*?---\s*/, "");
}

function presenceFactory(store, { handle, viewer }) {
  const target = viewer ?? (store.kind === "remote" ? store.url : null);
  if (target) {
    const send = presenceSender({ viewer: target, token: store.token, handle });
    return (book, product) => (activity) => send(product, activity);
  }
  if (store.kind === "github") return () => null;
  return (book) => (activity) => book.setPresence(handle, activity);
}

export async function runMcp({ store, handle, viewer }) {
  const multi = await isMulti(store);
  const server = new McpServer({ name: "screenbook", version: "0.2.0" }, { instructions: await skillText() });
  const presenceFor = presenceFactory(store, { handle, viewer });
  const single = bookOn(store);
  const origin = (viewer ?? (store.kind === "remote" ? store.url : "")).replace(/\/+$/, "");
  const ask = process.env.SCREENBOOK_ASK === "1";
  const tools = multi
    ? buildProductTools(store, { handle, presenceFor, viewer: origin, ask })
    : buildTools(single, { handle, presence: presenceFor(single, null), shareLink: (token) => `${origin}/s/${token}/`, ask });
  for (const [name, tool] of Object.entries(tools)) {
    server.registerTool(name, { description: tool.description, inputSchema: tool.input }, guarded(tool.run));
  }
  await server.connect(new StdioServerTransport());
}
