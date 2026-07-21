/**
 * TodoListCard — v3 port of the v1 playground interactive to-do card. Render
 * body (rows, checkmarks, remove buttons, add form) is verbatim; the v1
 * `useUpdateWidget` writes became the sanctioned `useCommit` seam — one guarded
 * transaction per edit, the whole "props" group written absolutely (the `items`
 * array serialized into its `p.json` string cell).
 *
 * Interactivity: native form elements (button/input) auto-bypass the dom
 * pointer router, and the `<li>` rows carry `data-canvas-interactive`
 * (2026-07-17, James: ALL internal interactions opt out) — a row click
 * toggles the item WITHOUT selecting or lifting the card. The trade-off is
 * deliberate: rows are no longer a drag surface, so the card moves by its
 * header, side padding, and footer. The remove button stops click propagation
 * so it doesn't also toggle the row it sits in. `draft` stays React state
 * (v1 parity) — only the todo items are widget data.
 *
 * size: large
 */
import { defineWidget, p } from "@vibecook/ice";
import { useCommit, useWidgetProps, type WidgetComponentProps } from "@vibecook/ice/react";
import { CardShell } from "@vibefield/shell-ui";
import { type ReactElement, useState } from "react";

/** v1 iOS "large" preset — the app seeds Size at spawn. */
export const TODO_SIZE = { w: 329, h: 345 };

const TYPE = "widgetlab.todo";

type TodoItem = { id: string; text: string; done: boolean };
type TodoListProps = {
  readonly title: string;
  readonly items: TodoItem[];
};

const DEFAULT_ITEMS: TodoItem[] = [
  { id: "1", text: "Ship RFC-006", done: true },
  { id: "2", text: "Audit pointer router", done: true },
  { id: "3", text: "Test in playground", done: false },
  { id: "4", text: "Document author contract", done: false },
];

function TodoListView({ entity, world }: WidgetComponentProps): ReactElement {
  const commit = useCommit();
  const props = useWidgetProps<TodoListProps>(world, entity, TYPE);
  const title = props?.title ?? "Today";
  const items = props?.items ?? DEFAULT_ITEMS;
  const [draft, setDraft] = useState("");

  // One guarded transaction; the whole "props" group written absolutely, with
  // `items` serialized into its json string cell.
  const writeItems = (nextItems: TodoItem[]): void => {
    const group = TodoListCard.groups.find((g) => g.name === "props");
    if (group === undefined) return;
    commit((tx) =>
      tx.edit(entity).set(group.component, {
        title,
        items: JSON.stringify(nextItems),
      } as never),
    );
  };

  const toggle = (id: string): void =>
    writeItems(items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));

  const remove = (id: string): void => writeItems(items.filter((it) => it.id !== id));

  const add = (): void => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    writeItems([...items, { id: `t${Date.now().toString(36)}`, text, done: false }]);
  };

  const remaining = items.filter((i) => !i.done).length;

  return (
    <CardShell world={world} entity={entity}>
      <div
        className="flex h-full w-full flex-col bg-black px-4 py-3"
        style={{ fontFamily: "-apple-system, system-ui, sans-serif" }}
      >
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[15px] font-semibold text-white">{title}</span>
          <span className="text-[10px] uppercase tracking-wider text-white/50">
            {remaining} left
          </span>
        </div>
        <ul className="-mx-1 flex-1 overflow-auto">
          {items.map((item) => (
            <li
              key={item.id}
              // Widget-internal control: the opt-out keeps a row click from ALSO
              // running the canvas tap→select path (design-002 §8 contract).
              data-canvas-interactive=""
              onClick={() => toggle(item.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") toggle(item.id);
              }}
              className="group flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-white/5"
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  item.done ? "border-emerald-400 bg-emerald-400/15" : "border-white/40"
                }`}
              >
                {item.done && <span className="block h-1.5 w-1.5 rounded-full bg-emerald-400" />}
              </span>
              <span
                className={`flex-1 truncate text-[12px] ${
                  item.done ? "text-white/40 line-through" : "text-white"
                }`}
              >
                {item.text}
              </span>
              <button
                type="button"
                aria-label="Remove task"
                // <button> is a native-interactive (router bypasses it). This
                // stopPropagation is load-bearing: it keeps the click from
                // bubbling to the row's onClick, which would toggle (resurrect)
                // the item we just removed.
                onClick={(e) => {
                  e.stopPropagation();
                  remove(item.id);
                }}
                className="text-[10px] text-white/40 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a task…"
            className="flex-1 rounded bg-white/5 px-2 py-1 text-[11px] text-white placeholder-white/30 outline-none focus:bg-white/10"
          />
          <button
            type="submit"
            className="rounded bg-white/10 px-2 py-1 text-[11px] text-white hover:bg-white/20"
          >
            Add
          </button>
        </form>
      </div>
    </CardShell>
  );
}

export const TodoListCard = defineWidget({
  type: TYPE,
  defaultSize: { w: 329, h: 345 }, // v1 scene size — tray tiles and inserts match the demo grid
  props: {
    title: p.string({ default: "Today" }),
    items: p.json(
      p.array(
        p.object({
          id: { kind: "string" },
          text: { kind: "string" },
          done: { kind: "boolean" },
        }),
      ),
      { default: DEFAULT_ITEMS },
    ),
  },
  surface: "dom",
  component: TodoListView,
  provides: ["widget"],
  interaction: { solid: true, dragOn: "press", resizable: false, snap: "both" },
});
