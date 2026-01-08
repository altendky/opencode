import * as vscode from "vscode"
import * as pty from "node-pty"

export interface OpencodePty {
  terminal: vscode.Terminal
  changeNameEmitter: vscode.EventEmitter<string>
  dispose: () => void
}

export function createOpencodePseudoterminal(
  port: number,
  context: vscode.ExtensionContext
): OpencodePty {
  const writeEmitter = new vscode.EventEmitter<string>()
  const changeNameEmitter = new vscode.EventEmitter<string>()
  const closeEmitter = new vscode.EventEmitter<number | void>()

  let ptyProcess: pty.IPty | undefined

  const pseudoTerminal: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidChangeName: changeNameEmitter.event,
    onDidClose: closeEmitter.event,

    open: (dimensions) => {
      // Spawn opencode process with proper PTY
      const shell = process.platform === "win32" ? "cmd.exe" : "bash"
      const shellArgs = process.platform === "win32"
        ? ["/c", "opencode", "--port", port.toString()]
        : ["-c", `opencode --port ${port}`]

      ptyProcess = pty.spawn(shell, shellArgs, {
        name: "xterm-256color",
        cols: dimensions?.columns ?? 80,
        rows: dimensions?.rows ?? 24,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
        env: {
          ...process.env,
          _EXTENSION_OPENCODE_PORT: port.toString(),
          OPENCODE_CALLER: "vscode",
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        } as { [key: string]: string },
      })

      // Pipe PTY output to terminal, parsing ANSI title escape sequences
      ptyProcess.onData((data) => {
        // Check for OSC (Operating System Command) title sequences
        // Format: ESC ] 0 ; title BEL  or  ESC ] 2 ; title BEL
        // ESC = \x1b, BEL = \x07
        const titleMatch = data.match(/\x1b\]([02]);([^\x07]*)\x07/)
        if (titleMatch) {
          const title = titleMatch[2]
          if (title) {
            changeNameEmitter.fire(title)
          }
        }
        writeEmitter.fire(data)
      })

      // Handle process exit
      ptyProcess.onExit(({ exitCode }) => {
        closeEmitter.fire(exitCode)
      })
    },

    close: () => {
      ptyProcess?.kill()
    },

    handleInput: (data: string) => {
      ptyProcess?.write(data)
    },

    setDimensions: (dimensions) => {
      ptyProcess?.resize(dimensions.columns, dimensions.rows)
    },
  }

  const terminal = vscode.window.createTerminal({
    name: "OpenCode",
    pty: pseudoTerminal,
    iconPath: {
      light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
      dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
    },
    location: {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
    },
  })

  return {
    terminal,
    changeNameEmitter,
    dispose: () => {
      ptyProcess?.kill()
      writeEmitter.dispose()
      changeNameEmitter.dispose()
      closeEmitter.dispose()
    },
  }
}
