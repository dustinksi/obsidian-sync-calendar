import { App, type PluginManifest, Plugin, PluginSettingTab, Setting,ToggleComponent } from 'obsidian';

import { SyncStatus, NetworkStatus } from 'Syncs/StatusEnumerate';
import { gfSyncStatus$, gfNetStatus$ } from 'Syncs/StatusEnumerate';
import { MainSynchronizer } from "Syncs/MainSynchronizer";
import QueryInjector from 'Injector/QueryInjector';
import { setDebugLogging } from 'lib/DebugLog';


// Remember to rename these classes and interfaces!

interface SyncCalendarPluginSettings {
  fetchWeeksAgo: number;
  fetchMaximumEvents: number;
  calendarsToFetchFrom: object
  renderDate: boolean;
  renderTags: boolean;

  enableLogging: boolean;
}

const DEFAULT_SETTINGS: SyncCalendarPluginSettings = {
  fetchWeeksAgo: 4,
  fetchMaximumEvents: 2000,
  calendarsToFetchFrom: {"primary": true},
  renderDate: true,
  renderTags: true,

  enableLogging: false,
}


export default class SyncCalendarPlugin extends Plugin {
  public settings: SyncCalendarPluginSettings;
  public settingsTab: SyncCalendarPluginSettingTab
  public syncStatusItem: HTMLElement;

  public netStatus: NetworkStatus;
  public netStatusItem: HTMLElement;

  private mainSync: MainSynchronizer;

  private queryInjector: QueryInjector;

  constructor(app: App, pluginManifest: PluginManifest) {
    super(app, pluginManifest);
  }

  async onload() {
    await this.loadSettings();
    setDebugLogging(this.settings.enableLogging);
    let settingsTab = new SyncCalendarPluginSettingTab(this.app, this)
    this.settingsTab = settingsTab
    window.onGoogleCalendar = settingsTab.createCalendersWidget //there's definitely a better way to do this, but i'm making a callback from the google calender sync.ts, so that when it fetches the calendar it updates the widget in settings
    this.addSettingTab(settingsTab);

    // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
    this.netStatusItem = this.addStatusBarItem();
    this.syncStatusItem = this.addStatusBarItem();

    gfNetStatus$.subscribe(newNetStatus => this.updateNetStatusItem(newNetStatus));
    gfSyncStatus$.subscribe(newSyncStatus => this.updateSyncStatusItem(newSyncStatus));

    this.mainSync = new MainSynchronizer(this.app, this);
    

    this.queryInjector = new QueryInjector(this);
    this.queryInjector.setMainSync(this.mainSync);

    this.registerMarkdownCodeBlockProcessor("sync-calendar",
      this.queryInjector.onNewBlock.bind(this.queryInjector)
    );

    // Add Ribbons
    const ribbonIconEl = this.addRibbonIcon(
      'sync',
      'Sync Google Calendar',
      async (evt: MouseEvent) => {
        const keyMoment = window.moment().startOf('day');
        const Ago = window.moment.duration(this.settings.fetchWeeksAgo, 'week');
        this.mainSync.pushTodosToCalendar(
          keyMoment.subtract(Ago),
          this.settings.fetchMaximumEvents,
          'mannual'
        );
      });
    ribbonIconEl.addClass('my-plugin-ribbon-class');

    // Add Commands
    this.addCommand({
      id: 'sync-google-calendar',
      name: 'Sync Google Calendar',
      callback: async () => {
        const keyMoment = window.moment().startOf('day');
        const Ago = window.moment.duration(this.settings.fetchWeeksAgo, 'week');
        this.mainSync.pushTodosToCalendar(
          keyMoment.subtract(Ago),
          this.settings.fetchMaximumEvents,
          'mannual'
        );
      }
    });

  }

  onunload() { }

  private updateNetStatusItem(newNetStatus: NetworkStatus) {
    switch (newNetStatus) {
      case NetworkStatus.HEALTH:
        this.netStatusItem.setText("Net: 🟢");
        break;
      case NetworkStatus.CONNECTION_ERROR:
        this.netStatusItem.setText("Net: 🔴");
        break;
      case NetworkStatus.UNKOWN:
      default:
        this.netStatusItem.setText("Net: ⚫️");
        break;
    }
  }

  private updateSyncStatusItem(newSyncStatus: SyncStatus) {
    switch (newSyncStatus) {
      case SyncStatus.UPLOAD:
        this.syncStatusItem.setText("Sync: 🔼");
        break;
      case SyncStatus.DOWNLOAD:
        this.syncStatusItem.setText("Sync: 🔽");
        break;
      case SyncStatus.FAILED_WARNING:
        this.syncStatusItem.setText("Sync: 🆖");
        break;
      case SyncStatus.SUCCESS_WAITING:
        this.syncStatusItem.setText("Sync: 🆗");
        break;
      case SyncStatus.UNKOWN:
      default:
        this.syncStatusItem.setText("Sync: *️⃣");
        break;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class SyncCalendarPluginSettingTab extends PluginSettingTab {
  plugin: SyncCalendarPlugin;
  calendar: any
  shouldPutCalendar: boolean;
  constructor(app: App, plugin: SyncCalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.shouldPutCalendar = false
  }
  createCalendersWidget = async (calenders: any) => {
    this.createHeader("Selected Calendars");
    const { containerEl } = this;
   
    console.log(containerEl)
    let actualCalendar = calenders.data.items.map(apiResponseCalendar => {
      return apiResponseCalendar.id
    })
    if (this.plugin.settings.calendarsToFetchFrom["primary"] == true) { //i believe the first entry in calendarList.list() is the primary calander, which is
      this.plugin.settings.calendarsToFetchFrom[actualCalendar[0]] = true
      delete this.plugin.settings.calendarsToFetchFrom["primary"]
      await this.plugin.saveSettings();
    }
    // console.log(actualCalendar)
    for (const calendar of actualCalendar) {

      let setting = new Setting(containerEl)
        .setName(calendar)
      setting.addToggle(toggle => {
        
        toggle.setValue(this.plugin.settings.calendarsToFetchFrom[calendar])
          .onChange(async (value) => {
            this.plugin.settings.calendarsToFetchFrom[calendar] = value;
            setDebugLogging(value);
            await this.plugin.saveSettings();
          })}
      ).controlEl.querySelector("input");
        
    }
    // this.shouldPutCalendar = false
    // this.display()

  }
  display(): void {
    
    const { containerEl } = this;
    containerEl.empty();
    if (this.shouldPutCalendar) {
      console.log("displaying calendar!")
      this.createCalendersWidget(this.calendar)
    }
    this.createHeader("Fetch");

    new Setting(containerEl)
      .setName("Weeks ago")
      .setDesc("Enter weeks from the earliest task to now for this plugin to consider.")
      .addText(text =>
        text
          .setValue(this.plugin.settings.fetchWeeksAgo.toString())
          .onChange(async (value) => {
            const weeksAgo = parseInt(value);
            if (!isNaN(weeksAgo)) {
              this.plugin.settings.fetchWeeksAgo = weeksAgo;
            }
            await this.plugin.saveSettings();
          })
      ).controlEl.querySelector("input");

    new Setting(containerEl)
      .setName("Maximum events")
      .setDesc("Enter the maximum number of events in the fetching window")
      .addText(text =>
        text
          .setValue(this.plugin.settings.fetchMaximumEvents.toString())
          .onChange(async (value) => {
            const maximumEvents = parseInt(value);
            if (!isNaN(maximumEvents)) {
              this.plugin.settings.fetchMaximumEvents = maximumEvents;
              await this.plugin.saveSettings();
            }
          })
      ).controlEl.querySelector("input");

    this.createHeader("Render");

    new Setting(containerEl)
      .setName("Render date")
      .setDesc("Whether date should be rendered with google events.")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.renderDate)
          .onChange(async (value) => {
            this.plugin.settings.renderDate = value;
            await this.plugin.saveSettings();
          })
      )
      .controlEl.querySelector("input");

    new Setting(containerEl)
      .setName("Render tags")
      .setDesc("Whether tags should be rendered with google events.")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.renderTags)
          .onChange(async (value) => {
            this.plugin.settings.renderTags = value;
            await this.plugin.saveSettings();
          })
      )
      .controlEl.querySelector("input");

    this.createHeader("Debug");

    // Debug logging enabled checkbox
    new Setting(containerEl)
      .setName("Enable logging")
      .setDesc("Enable debug logging might help to locate synchronization issues.")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.enableLogging)
          .onChange(async (value) => {
            this.plugin.settings.enableLogging = value;
            setDebugLogging(value);
            await this.plugin.saveSettings();
          })
      )
      .controlEl.querySelector("input");
    
    // this.referenceEl = containerEl.querySelector("setting-item")
  }

  private createHeader(header_title: string, header_desc: string | null = null) {
    // this.containerEl.createEl('h3', { text: "hello" });
    const header = this.containerEl.createDiv();
    header.createEl('p', { text: header_title, cls: 'sync-calendar-setting-header-title' });
    if (header_desc) {
      header.createEl('p', { text: header_desc, cls: 'sync-calendar-setting-header-description' });
    }
  }
}
