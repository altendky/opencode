// This method is called when your extension is deactivated
export function deactivate() {
  // Clean up all active terminals
  for (const [, pty] of activeTerminals) {
    pty.dispose()
  }
  activeTerminals.clear()
}

import * as vscode from "vscode"
import { createOpencodePseudoterminal, OpencodePty } from "./pseudoterminal"

const TERMINAL_NAME = "OpenCode"

// Track active terminals by port
const activeTerminals = new Map<number, OpencodePty>()

export function activate(context: vscode.ExtensionContext) {
  let openNewTerminalDisposable = vscode.commands.registerCommand("opencode.openNewTerminal", async () => {
    await openTerminal(context)
  })

  let openTerminalDisposable = vscode.commands.registerCommand("opencode.openTerminal", async () => {
    // An opencode terminal already exists => focus it
    const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      existingTerminal.show()
      return
    }

    await openTerminal(context)
  })

  let addFilepathDisposable = vscode.commands.registerCommand("opencode.addFilepathToTerminal", async () => {
    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    const terminal = vscode.window.activeTerminal
    if (!terminal) {
      return
    }

    if (terminal.name === TERMINAL_NAME || terminal.name.startsWith("OC | ")) {
      // Find the port for this terminal
      const port = findPortForTerminal(terminal)
      if (port) {
        await appendPrompt(port, fileRef)
      } else {
        terminal.sendText(fileRef, false)
      }
      terminal.show()
    }
  })

  // Clean up when terminals are closed
  const terminalCloseListener = vscode.window.onDidCloseTerminal((closedTerminal) => {
    const entry = [...activeTerminals.entries()].find(([, pty]) => pty.terminal === closedTerminal)
    if (entry) {
      const [port, pty] = entry
      pty.dispose()
      activeTerminals.delete(port)
    }
  })

  context.subscriptions.push(
    openTerminalDisposable,
    openNewTerminalDisposable,
    addFilepathDisposable,
    terminalCloseListener
  )

  function findPortForTerminal(terminal: vscode.Terminal): number | undefined {
    for (const [port, pty] of activeTerminals) {
      if (pty.terminal === terminal) {
        return port
      }
    }
    return undefined
  }

  async function openTerminal(context: vscode.ExtensionContext) {
    // Generate a random port
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384

    // Create pseudoterminal (title updates come from ANSI escape sequences)
    const pty = createOpencodePseudoterminal(port, context)
    pty.terminal.show()

    // Track terminal
    activeTerminals.set(port, pty)

    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    // Wait for the terminal to be ready
    let tries = 10
    let connected = false
    do {
      await new Promise((resolve) => setTimeout(resolve, 200))
      try {
        await fetch(`http://localhost:${port}/app`)
        connected = true
        break
      } catch (e) {}

      tries--
    } while (tries > 0)

    // If connected, append the prompt to the terminal
    if (connected) {
      await appendPrompt(port, `In ${fileRef}`)
      pty.terminal.show()
    }
  }

  async function appendPrompt(port: number, text: string) {
    await fetch(`http://localhost:${port}/tui/append-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    })
  }

  function getActiveFile() {
    const activeEditor = vscode.window.activeTextEditor
    if (!activeEditor) {
      return
    }

    const document = activeEditor.document
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!workspaceFolder) {
      return
    }

    // Get the relative path from workspace root
    const relativePath = vscode.workspace.asRelativePath(document.uri)
    let filepathWithAt = `@${relativePath}`

    // Check if there's a selection and add line numbers
    const selection = activeEditor.selection
    if (!selection.isEmpty) {
      // Convert to 1-based line numbers
      const startLine = selection.start.line + 1
      const endLine = selection.end.line + 1

      if (startLine === endLine) {
        // Single line selection
        filepathWithAt += `#L${startLine}`
      } else {
        // Multi-line selection
        filepathWithAt += `#L${startLine}-${endLine}`
      }
    }

    return filepathWithAt
  }
}
