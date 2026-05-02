import { createContext, createMemo, createSignal, useContext, type Accessor, type ParentProps } from "solid-js"
import { DialogSelect, type DialogSelectRef } from "@tui/ui/dialog-select"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import {
  formatKeyBindings,
  reactiveMatcherFromSignal,
  type OpenTuiKeymap,
  useKeymapSelector,
  useOpencodeKeymap,
} from "../keymap"
import { useTuiConfig } from "./tui-config"

type SlashEntry = {
  display: string
  description?: string
  aliases?: string[]
  onSelect: () => void
}

type CommandPaletteContext = {
  run(command: string): void
  show(): void
  slashes: Accessor<readonly SlashEntry[]>
  suspend(enabled: boolean): void
  readonly suspended: boolean
  matcher: ReturnType<typeof reactiveMatcherFromSignal>
}

const COMMAND_PALETTE_DIALOG = "command.palette.show"
const ctx = createContext<CommandPaletteContext>()
type PaletteCommandEntry = ReturnType<OpenTuiKeymap["getCommandEntries"]>[number]

function isVisiblePaletteCommand(entry: PaletteCommandEntry) {
  return entry.command.fields.hidden !== true && entry.command.name !== COMMAND_PALETTE_DIALOG
}

export function CommandPaletteProvider(props: ParentProps) {
  const dialog = useDialog()
  const keymap = useOpencodeKeymap()
  const [suspendCount, setSuspendCount] = createSignal(0)
  const entries = useKeymapSelector((keymap: OpenTuiKeymap) =>
    keymap
      .getCommandEntries({
        visibility: "reachable",
        namespace: "palette",
      })
      .filter(isVisiblePaletteCommand),
  )

  const run = (command: string) => {
    keymap.dispatchCommand(command)
  }

  const slashes = createMemo<SlashEntry[]>(() =>
    entries().flatMap((entry) => {
      const slashName = entry.command.fields.slashName
      if (typeof slashName !== "string" || !slashName) return []
      const slashAliases = entry.command.fields.slashAliases
      return {
        display: `/${slashName}`,
        description:
          typeof entry.command.fields.desc === "string" ? entry.command.fields.desc : (entry.command.fields.title as string),
        aliases: Array.isArray(slashAliases)
          ? slashAliases.filter((alias): alias is string => typeof alias === "string").map((alias) => `/${alias}`)
          : undefined,
        onSelect: () => run(entry.command.name),
      }
    }),
  )

  const value: CommandPaletteContext = {
    run,
    show() {
      dialog.replace(() => <CommandPaletteDialog run={run} />)
    },
    slashes,
    suspend(enabled: boolean) {
      setSuspendCount((count) => Math.max(0, count + (enabled ? 1 : -1)))
    },
    get suspended() {
      return suspendCount() > 0 || dialog.stack.length > 0
    },
    matcher: reactiveMatcherFromSignal(() => suspendCount() === 0 && dialog.stack.length === 0),
  }

  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useCommandPalette() {
  const value = useContext(ctx)
  if (!value) throw new Error("CommandPalette context must be used within a CommandPaletteProvider")
  return value
}

function CommandPaletteDialog(props: { run(command: string): void }) {
  const config = useTuiConfig()
  const entries = useKeymapSelector((keymap: OpenTuiKeymap) => {
    const query = {
      namespace: "palette",
    }
    const reachable = keymap
      .getCommandEntries({
        ...query,
        visibility: "reachable",
      })
      .filter(isVisiblePaletteCommand)
    const registeredBindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: reachable.map((entry) => entry.command.name),
    })

    return reachable.map((entry) => ({
      ...entry,
      bindings: registeredBindings.get(entry.command.name) ?? entry.bindings,
    }))
  })
  const options = createMemo(() =>
    entries().map((entry) => ({
      title: typeof entry.command.fields.title === "string" ? entry.command.fields.title : entry.command.name,
      description: typeof entry.command.fields.desc === "string" ? entry.command.fields.desc : undefined,
      category: typeof entry.command.fields.category === "string" ? entry.command.fields.category : undefined,
      footer: formatKeyBindings(entry.bindings, config),
      value: entry.command.name,
      suggested: entry.command.fields.suggested === true,
      onSelect: (dialog: DialogContext) => {
        dialog.clear()
        props.run(entry.command.name)
      },
    })),
  )

  let ref: DialogSelectRef<string>
  const list = () => {
    if (ref?.filter) return options()
    return [
      ...options()
        .filter((option) => option.suggested)
        .map((option) => ({
          ...option,
          value: `suggested:${option.value}`,
          category: "Suggested",
        })),
      ...options(),
    ]
  }

  return <DialogSelect ref={(value) => (ref = value)} title="Commands" options={list()} />
}

export function useCommandSlashes(): Accessor<readonly SlashEntry[]> {
  return useCommandPalette().slashes
}
