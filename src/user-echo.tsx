// .opencode/plugins/user-echo.tsx (file extension must be .tsx)
//
// ⚠ Loading differs from server plugins: the TUI plugin must be declared in the "plugin" array of tui.json:
//   .opencode/tui.json
//   { "$schema": "https://opencode.ai/tui.json", "plugin": ["./.opencode/plugins/user-echo.tsx"] }
//
// Position: mounted in the session_prompt slot (mode=replace) as an "echo panel + native Prompt".
// It replaces the default Prompt, so the echo stays above the input box and below the message scroll area.
// Pure TUI rendering: no message creation, no context export, and no revert interaction.

import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createSignal, createMemo, Show, For } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"

type Echo = { text: string; isCommand: boolean }

const tui: TuiPlugin = async (api) => {
  const [echoes, setEchoes] = createSignal<Record<string, Echo>>({})
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
  const [interactionLocked, setInteractionLocked] = createSignal<Record<string, boolean>>({})
  const commandByMessage = new Map<string, string>()

  const offCmd = api.event.on("command.executed", (event) => {
    const p = event.properties
    const args = p.arguments?.trim()
    commandByMessage.set(p.messageID, `/${p.name}${args ? " " + args : ""}`)
  })

  // After the AI response ends, capture the last user message as the echo content.
  const offIdle = api.event.on("session.idle", async (event) => {
    const sessionID = (event.properties as any)?.sessionID
    if (!sessionID) return
    setInteractionLocked((prev) => ({ ...prev, [sessionID]: false }))
    try {
      const res: any = await (api.client.session as any).messages({ sessionID })
      const list: any[] = res?.data ?? res ?? []
      const lastUser = [...list].reverse().find((m) => (m.info ?? m).role === "user")
      if (!lastUser) return
      const info = lastUser.info ?? lastUser
      const parts: any[] = lastUser.parts ?? []

      const cmd = commandByMessage.get(info.id)
      commandByMessage.delete(info.id)

      const text =
        cmd ??
        parts
          .filter((x) => x.type === "text" && !x.synthetic && !x.ignored)
          .map((x) => x.text)
          .join("\n")
          .trim()
      if (!text) return

      setEchoes((prev) => ({ ...prev, [sessionID]: { text, isCommand: !!cmd } }))
      setExpanded((prev) => ({ ...prev, [sessionID]: false }))
    } catch {
      // Display-only feature, fail silently.
    }
  })

  api.lifecycle.onDispose(() => {
    offCmd()
    offIdle()
  })

  api.slots.register({
    order: 100,
    slots: {
      // session_prompt uses replace mode: the returned content replaces the default Prompt,
      // so we restore the native input box below the panel with api.ui.Prompt (all props are passed through).
      session_prompt(_ctx, props: any) {
        const sessionID = props.session_id
        return (
          <box>
            <Show when={props.visible !== false}>
              <EchoPanel
                api={api}
                sessionID={sessionID}
                echoes={echoes}
                expanded={expanded}
                interactionLocked={interactionLocked}
                setExpanded={setExpanded}
              />
            </Show>
            <api.ui.Prompt
              sessionID={sessionID}
              visible={props.visible}
              disabled={props.disabled}
              onSubmit={async (...args: any[]) => {
                setExpanded((prev) => ({ ...prev, [sessionID]: false }))
                setInteractionLocked((prev) => ({ ...prev, [sessionID]: true }))
                await props.on_submit?.(...args)
              }}
              ref={props.ref}
              right={<api.ui.Slot name="session_prompt_right" session_id={sessionID} />}
            />
          </box>
        )
      },
    },
  })
}

function EchoPanel(props: {
  api: TuiPluginApi
  sessionID: string
  echoes: () => Record<string, Echo>
  expanded: () => Record<string, boolean>
  interactionLocked: () => Record<string, boolean>
  setExpanded: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void
}) {
  const theme = () => props.api.theme.current
  const term = useTerminalDimensions()

  const echo = createMemo(() => props.echoes()[props.sessionID])
  const lines = createMemo(() => echo()?.text.split("\n") ?? [])
  const displayLines = createMemo(() => (echo() ? ["📌 Expanded content", ...lines()] : []))
  const isExpanded = createMemo(() => props.expanded()[props.sessionID] ?? false)
  const isLocked = createMemo(() => props.interactionLocked()[props.sessionID] ?? false)

  // Expanded content height limit: 50% of the terminal height, keeping the input box and "Collapse" button visible.
  const maxHeight = createMemo(() => Math.max(3, Math.floor(term().height * 0.5)))
  const needScroll = createMemo(() => displayLines().length > maxHeight())

  const toggle = () =>
    props.setExpanded((prev) => ({ ...prev, [props.sessionID]: !prev[props.sessionID] }))

  const content = () => (
    <For each={displayLines()}>
      {(line, index) => <text fg={index() === 0 ? theme().accent : theme().text}>{line || " "}</text>}
    </For>
  )

  return (
    <Show when={echo()}>
      {/* Top border = horizontal line; collapsed state always takes exactly one line. */}
      <box border={["top"]} borderColor={theme().backgroundElement} paddingLeft={2} paddingRight={2}>
        <Show
          when={isExpanded()}
          fallback={
            <box onMouseUp={isLocked() ? undefined : toggle}>
               <text fg={theme().accent}>{`▼ Click to expand the full message (${displayLines().length} lines)`}</text>
            </box>
          }
        >
          {/* Use scrollbox when content exceeds the limit: mouse wheel scrolls vertically, and "Collapse" stays fixed at the bottom. */}
          <Show when={needScroll()} fallback={content()}>
            <scrollbox
              height={maxHeight()}
              scrollbarOptions={{ visible: true }}
              verticalScrollbarOptions={{
                visible: true,
                trackOptions: {
                  backgroundColor: theme().backgroundElement,
                  foregroundColor: theme().border,
                },
              }}
            >
              {content()}
            </scrollbox>
          </Show>
          <box onMouseUp={isLocked() ? undefined : toggle}>
            <text fg={theme().accent}>▲ Collapse</text>
          </box>
        </Show>
      </box>
    </Show>
  )
}

export default {
  id: "user-echo",
  tui,
}
