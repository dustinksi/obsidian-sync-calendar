import {
  type MarkdownPostProcessorContext,
  MarkdownRenderChild,
} from "obsidian";
import type { SvelteComponentDev } from "svelte/internal";

import type SyncCalendarPlugin from "main";
import type { MainSynchronizer } from "Syncs/MainSynchronizer";
import CalendarQuery from "ui/CalendarQuery.svelte";
import ErrorDisplay from "ui/ErrorDisplay.svelte";
import { debug } from "lib/DebugLog";

import { parseQuery } from "./Parser";
import type { Query } from "./Query";

export default class QueryInjector {
  private pendingQueries: PendingQuery[];

  private plugin: SyncCalendarPlugin;
  private mainSync: MainSynchronizer

  constructor(plugin: SyncCalendarPlugin) {
    this.plugin = plugin;
    this.pendingQueries = [];
  }

  onNewBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const pendingQuery = {
      source: source,
      target: el,
      ctx: ctx,
    };

    if (typeof this.mainSync == "undefined") {
      this.pendingQueries.push(pendingQuery);
      return;
    }

    this.injectQuery(pendingQuery);
  }

  setMainSync(mainSync: MainSynchronizer) {
    this.mainSync = mainSync;

    while (this.pendingQueries.length > 0) {
      this.injectQuery(this.pendingQueries[0]);
      this.pendingQueries.splice(0, 1);
    }
  }

  injectQuery(pendingQuery: PendingQuery) {
    let child: InjectedQuery;

    try {
      let query: Query;
      if (pendingQuery.source.length > 0) {
        query = parseQuery(pendingQuery.source);
      }

      child = new InjectedQuery(pendingQuery.target, (root: HTMLElement) => {
        return new CalendarQuery({
          target: root,
          props: {
            plugin: this.plugin,
            api: this.mainSync,
            query: query,
          },
        });
      });
    }
    catch (err) {
      debug(`query error: ${err}`);
      console.error(err)
      child = new InjectedQuery(pendingQuery.target, (root: HTMLElement) => {
        return new ErrorDisplay({
          target: root,
          props: {
            error: err
          },
        });
      });
    }

    pendingQuery.ctx.addChild(child);
  }

}

interface PendingQuery {
  source: string;
  target: HTMLElement;
  ctx: MarkdownPostProcessorContext;
}

class InjectedQuery extends MarkdownRenderChild {
  private readonly createComp: (root: HTMLElement) => SvelteComponentDev;
  private component: SvelteComponentDev;

  constructor(
    container: HTMLElement,
    createComp: (root: HTMLElement) => SvelteComponentDev
  ) {
    super(container);
    this.containerEl = container;
    this.createComp = createComp;
  }

  onload() {
    this.component = this.createComp(this.containerEl);
  }

  onunload() {
    if (this.component) {
      this.component.$destroy();
    }
  }
}
