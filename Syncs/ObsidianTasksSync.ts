import crypto from "crypto";
import { Mutex } from 'async-mutex';
import { App, TFile, Notice } from "obsidian";
import { DataviewApi, getAPI, isPluginEnabled, type STask } from "obsidian-dataview";

import { DEFAULT_SYMBOLS } from "TodoSerialization/DefaultSerialization";
import { DefaultTodoSerializer, type TodoDetails } from "TodoSerialization";
import { Todo } from "TodoSerialization/Todo";
import { debug } from "lib/DebugLog";

/**
 * This class is responsible for syncing tasks between Obsidian and a calendar.
 * 这个类负责在 Obsidian 和日历之间同步任务。
 */
export class ObsidianTasksSync {
  private app: App;
  private dataviewAPI: DataviewApi | undefined;
  private deserializer: DefaultTodoSerializer;
  private readonly fileMutex: Mutex;

  constructor(app: App) {
    if (!isPluginEnabled(app)) {
      new Notice("You need to install dataview first!");
      throw Error("dataview is not avaliable!");
    }
    this.deserializer = new DefaultTodoSerializer(DEFAULT_SYMBOLS);
    this.app = app;
    this.dataviewAPI = getAPI(app);
    if (!this.dataviewAPI) {
      new Notice("Dateview API enable failed!");
      throw Error("dataview api enable failed!");
    }
    this.fileMutex = new Mutex();
  }

  /**
   * Deletes a todo item from its file.
   * 从文件中删除待办事项。
   * @param todo - The todo item to delete.
   */
  public async deleteTodo(todo: Todo): Promise<void> {
    this.updateFileContent(todo, (fileLines, targetLineNumber) => {
      // Filter out the line containing the todo item's blockId to delete the todo item from its file.
      // 通过过滤掉包含待办事项块 ID 的行，从文件中删除待办事项。
      return fileLines.filter((line) => !line.includes(todo.blockId!));
    });
  }

  static getStatusDonePatch(todo: Todo, line: string): string {
    // Replace "- [ ] " with "- [x] " to indicate that the task has been completed
    // 将“- [ ]”替换为“- [x]”，表示任务已完成
    return line.replace(/.*(- \[.\] )/, '- [x] ');
  }

  /**
   * Marks a todo item as done in its file.
   * 在文件中标记待办事项为已完成。
   * @param todo - The todo item to mark as done.
   * @param getTodoPatch - A function that returns the updated line for the todo item.
   */
  public async patchTodo(todo: Todo, getTodoPatch: (todo: Todo, line: string) => string): Promise<void> {
    this.updateFileContent(todo, (fileLines, targetLineNumber) => {
      let matchResult = fileLines[targetLineNumber].match(/.*- \[.\] /);
      if (!matchResult) {
        debug(`We cannot find a line with pattern - [ ] in ${fileLines[targetLineNumber]}`);;
        return fileLines;
      }

      const updatedLines: string[] = [
        ...fileLines.slice(0, targetLineNumber),
        getTodoPatch(todo, fileLines[targetLineNumber]),
        ...fileLines.slice(targetLineNumber + 1),
      ];
      return updatedLines;
    });
  }

  /**
   * Updates a todo item in its file.
   * 更新文件中的待办事项。
   * @param todo - The todo item to update.
   */
  public async updateTodo(todo: Todo) {
    await this.updateFileContent(todo, (fileLines, targetLineNumber) => {
      let matchResult = fileLines[targetLineNumber].match(/.*- \[.\] /);
      if (!matchResult) {
        return fileLines;
      }

      let updatedLine = matchResult[0]! + this.deserializer.serialize(todo);
      const updatedLines: string[] = [
        ...fileLines.slice(0, targetLineNumber),
        updatedLine,
        ...fileLines.slice(targetLineNumber + 1),
      ];
      return updatedLines;
    });
  }

  /**
   * Fetches todos based on a key moment and a time window bias ahead.
   * 根据关键时刻和时间窗口偏差获取待办事项。
   * @param startMoment - The key moment to fetch todos for.
   * @param triggeredBy - Whether the fetch was triggered automatically or manually.
   * @returns An array of todos.
   */
  public listTasks(startMoment: moment.Moment, triggeredBy: 'auto' | 'mannual' = 'auto'): Todo[] {
    let obTodos: Todo[] = [];

    const queriedTasks = this.dataviewAPI!.pages().file.tasks
      .where((task: STask) => {
        let taskMatch = task.text.match(/🛫 {0,2}(\d{4}-\d{2}-\d{2})/u);
        if (!taskMatch) { return false; }
        return !window.moment(taskMatch[1]).isBefore(startMoment.startOf('day'));
      });

    queriedTasks.values.forEach(async (task: STask) => {
      //  对抓取到的 tasks，没有指定 blockId 需要创建 hashed blockId。
      let todo_details: TodoDetails | null = null;
      if (task.blockId && task.blockId.length > 0) {
        todo_details = this.deserializer.deserialize(task.text);
      } else {
        if (triggeredBy == 'auto') {
          const cursorPosition = this.app.workspace.activeEditor?.editor?.getCursor();
          if (cursorPosition?.line === task.position.start.line) {
            debug("task is on editing, skip it!");
            return;
          }
        }

        const hash = crypto.createHash("sha256").update(task.text).digest();
        let shorternTaskHash = parseInt(hash.toString("hex").slice(0, 16), 16).toString(36).toUpperCase();
        // TODO: 判断重复性 task id 的重复性
        shorternTaskHash = shorternTaskHash.padStart(8, "0");

        await this.fileMutex.runExclusive(async () => {
          const file = this.app.vault.getAbstractFileByPath(task.path);
          if (!(file instanceof TFile)) {
            new Notice(`sync-calendar: No file found for task ${task.text}. Retrying ...`);
            return;
          }

          const fileContent = await self.app.vault.read(file);
          const fileLines = fileContent.split('\n');

          const updatedFileLines = [
            ...fileLines.slice(0, task.position.start.line),
            `${fileLines[task.position.start.line]} ^${shorternTaskHash}`,
            ...fileLines.slice(task.position.start.line + 1),
          ];

          await self.app.vault.modify(file, updatedFileLines.join('\n'));
        });
        todo_details = this.deserializer.deserialize(`${task.text} ^${shorternTaskHash}`);
      }

      const todo = new Todo({
        ...todo_details,
        path: task.path,
        eventStatus: task.status
      });

      if (window.moment(todo.startDateTime!).isBefore(startMoment)) {
        return;
      }
      obTodos.push(todo);
    });

    return obTodos;
  }


  /**
   * Updates the content of a file containing a todo item.
   * @param todo - The todo item to update.
   * @param updateFunc - A function that takes in the file lines and the target line prefix and returns the updated line.
   */
  private async updateFileContent(todo: Todo, updateFunc: (fileLines: string[], targetLine: number) => string[]): Promise<void> {
    // Check if todo has valid path and blockId
    if (!todo.path || !todo.blockId) {
      debug(`${todo.content} todo has invalid path or blockId`);
      debug(todo);
      throw Error(`${todo.content} todo has invalid path or blockId`);
    }

    // Get the file containing the todo
    const file = this.app.vault.getAbstractFileByPath(todo.path);
    if (!(file instanceof TFile)) {
      new Notice(`No file found for todo ${todo.content}.`);
      throw Error(`No file found for todo ${todo.content}`);
    }

    // Update the file content
    await this.fileMutex.runExclusive(async () => {
      const fileContent = await self.app.vault.read(file);
      const originFileLines = fileContent.split('\n');

      let targetLine: number | undefined = undefined;
      originFileLines.forEach((line, line_index) => {
        let index = line.indexOf(todo.blockId!);
        if (index > -1) {
          targetLine = line_index;
        }
      });
      if (targetLine === undefined) {
        debug("Cannot find line/prefix for updated todo: " + todo.content);
        return;
      }

      const updatedFileLines = updateFunc(originFileLines, targetLine!);
      self.app.vault.modify(file, updatedFileLines.join('\n'));
    });
  }

}

