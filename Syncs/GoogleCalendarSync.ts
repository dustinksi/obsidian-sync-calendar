import * as path from 'path';

import type { App, Vault, Notice, FileSystemAdapter, Plugin } from 'obsidian';
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';
import type { OAuth2Client, GaxiosPromise, GaxiosResponse } from 'googleapis-common';
import type { calendar_v3 } from 'googleapis';

import { Todo } from 'TodoSerialization/Todo';
import { debug } from 'lib/DebugLog';

import {
  NetworkStatus,
  SyncStatus,
  gfSyncStatus$,
  gfNetStatus$
} from './StatusEnumerate';
import type SyncCalendarPlugin from 'main';

/**
 * This class handles syncing with Google Calendar.
 */
export class GoogleCalendarSync {
  vault: Vault;

  public SCOPES = ['https://www.googleapis.com/auth/calendar'];
  private TOKEN_PATH = ""
  private CREDENTIALS_PATH = ""
  public plugin: Plugin
  private isTokenValid = true;
  private isTokenRefreshing = false;

  constructor(app: App, plugin:Plugin) {
    this.vault = app.vault
    this.plugin = plugin
    // Set the paths for the token and credentials files
    this.TOKEN_PATH = path.join(this.vault.configDir, 'calendar.sync.token.json');
    this.CREDENTIALS_PATH = path.join(this.vault.configDir, 'calendar.sync.credentials.json');
  }
  async updateSettingsMenu() {
    let auth = await this.authorize();
    const calendar = google.calendar({ version: 'v3', auth });

    // Set the sync and network status to DOWNLOAD
    gfSyncStatus$.next(SyncStatus.DOWNLOAD);
    // console.log()
    
    let castedPlugin = this.plugin as SyncCalendarPlugin
    castedPlugin.settingsTab.shouldPutCalendar = true //see main.ts for def


    castedPlugin.settingsTab.calendar = await calendar.calendarList.list()
    castedPlugin.settingsTab.display()
 
  }
  /**
   * Returns a list of completed and uncompleted events.
   * @param startMoment The start moment for the events to retrieve.
   * @param maxResults The maximum number of results to retrieve.
   * @returns A Promise that resolves to an array of Todo objects.
   */
  async listEvents(startMoment: moment.Moment, maxResults: number = 200): Promise<Todo[]> {
    let auth = await this.authorize();
    const calendar = google.calendar({ version: 'v3', auth });

    // Set the sync and network status to DOWNLOAD
    gfSyncStatus$.next(SyncStatus.DOWNLOAD);
    // console.log()
    
    let castedPlugin = this.plugin as SyncCalendarPlugin
   
    let calendars = castedPlugin.settings.calendarsToFetchFrom
    // Retrieve the events from Google Calendar
    let eventsListQueryResult = []
    for (const key in calendars) {
      if (!calendars[key]) { //calendar is not enabled
        continue
      }

      let calendarID = key
      console.log("getting data for " + calendarID)
      const oneCalendar =
        await calendar.events
          .list({
            calendarId: calendarID,
            timeMin: startMoment.toISOString(),
            maxResults: maxResults,
            singleEvents: true,
            orderBy: 'startTime',
          })
          .catch(err => {
            if (err.message == 'invalid_grant') {
              this.isTokenValid = false;
            }
            // Set the network status to CONNECTION_ERROR and the sync status to FAILED_WARNING
            gfNetStatus$.next(NetworkStatus.CONNECTION_ERROR);
            gfSyncStatus$.next(SyncStatus.FAILED_WARNING);
            throw err;
          });
          // console.log("data: ", oneCalendar)
          eventsListQueryResult = [...eventsListQueryResult, ...oneCalendar.data.items]
    }
    console.log(eventsListQueryResult)
    // Set the network status to HEALTH and the sync status to SUCCESS_WAITING
    gfNetStatus$.next(NetworkStatus.HEALTH);
    gfSyncStatus$.next(SyncStatus.SUCCESS_WAITING);

    let eventsMetaList = eventsListQueryResult;
    let eventsList: Todo[] = [];

    if (eventsMetaList != undefined) {
      eventsMetaList.forEach((eventMeta: calendar_v3.Schema$Event) => {
        eventsList.push(Todo.fromGoogleEvent(eventMeta));
      });
    }

    return eventsList;
  }

  /**
   * Inserts a new event into Google Calendar.
   * @param todo The Todo object to insert.
   */
  async insertEvent(todo: Todo) {
    let auth = await this.authorize();
    const calendar: calendar_v3.Calendar = google.calendar({ version: 'v3', auth });

    let retryTimes = 0;
    let isInsertSuccess = false;

    // Set the sync status to UPLOAD and attempt to insert the event
    gfSyncStatus$.next(SyncStatus.UPLOAD);
    while (retryTimes < 20 && !isInsertSuccess) {
      console.log("attempting to send info about " + todo.content)
      ++retryTimes;
      await calendar.events
        .insert({
          auth: auth,
          calendarId: 'primary',
          resource: Todo.toGoogleEvent(todo)
        } as calendar_v3.Params$Resource$Events$Insert
        )
        .then((event) => {
          isInsertSuccess = true;
          debug(`Added event: ${todo.content}! link: ${event.data.htmlLink}`);
          return;
        }).catch(async (error) => {
          debug(`Error on inserting event: ${error}`);
          await new Promise(resolve => setTimeout(resolve, 100));
        });
    }

    // Set the sync status and network status based on whether the insert was successful
    if (isInsertSuccess) {
      gfSyncStatus$.next(SyncStatus.SUCCESS_WAITING);
      gfNetStatus$.next(NetworkStatus.HEALTH);
    } else {
      gfSyncStatus$.next(SyncStatus.FAILED_WARNING);
      gfNetStatus$.next(NetworkStatus.CONNECTION_ERROR);
      throw Error(`Failed to insert event: ${todo.content}`);
    }
  }

  /**
   * Deletes an event from Google Calendar.
   * @param todo The Todo object to delete.
   */
  async deleteEvent(todo: Todo): Promise<void> {
    let auth = await this.authorize();
    const calendar = google.calendar({ version: 'v3', auth });

    let retryTimes = 0;
    let isDeleteSuccess = false;

    // Set the sync status to UPLOAD and attempt to delete the event
    gfSyncStatus$.next(SyncStatus.UPLOAD);
    while (retryTimes < 20 && !isDeleteSuccess) {
      ++retryTimes;

      await calendar.events
        .delete({
          auth: auth,
          calendarId: 'primary',
          eventId: todo.eventId
        } as calendar_v3.Params$Resource$Events$Delete)
        .then(() => {
          isDeleteSuccess = true;
          debug(`Deleted event: ${todo.content}!`);
          return;
        }).catch(async (err) => {
          debug(`Error on delete event: ${err}`);
          await new Promise(resolve => setTimeout(resolve, 100));
        });
    }

    // Set the sync status and network status based on whether the delete was successful
    if (isDeleteSuccess) {
      gfSyncStatus$.next(SyncStatus.SUCCESS_WAITING);
      gfNetStatus$.next(NetworkStatus.HEALTH);
    } else {
      gfSyncStatus$.next(SyncStatus.FAILED_WARNING);
      gfNetStatus$.next(NetworkStatus.CONNECTION_ERROR);
      throw Error(`Failed to delete event: ${todo.content}`);
    }
  }

  /**
   * Patches an event in Google Calendar.
   * @param todo The Todo object to patch.
   * @param getEventPatch A function that returns the patch to apply to the event.
   */
  async patchEvent(todo: Todo, getEventPatch: (todo: Todo) => calendar_v3.Schema$Event): Promise<void> {
    let auth = await this.authorize();
    const calendar = google.calendar({ version: 'v3', auth });

    let retryTimes = 0;
    let isPatchSuccess = false;

    // Set the sync status to UPLOAD and attempt to patch the event
    gfSyncStatus$.next(SyncStatus.UPLOAD);
    while (retryTimes < 20 && !isPatchSuccess) {
      ++retryTimes;

      await calendar.events
        .patch({
          auth: auth,
          calendarId: 'primary',
          eventId: todo.eventId,
          resource: getEventPatch(todo)
        } as calendar_v3.Params$Resource$Events$Patch)
        .then(() => {
          isPatchSuccess = true;
          debug(`Patched event: ${todo.content}!`);
          return;
        }).catch(async (err) => {
          debug(`Error on patch event: ${err}`);
          await new Promise(resolve => setTimeout(resolve, 100));
        });
    }

    // Set the sync status and network status based on whether the patch was successful
    if (isPatchSuccess) {
      gfSyncStatus$.next(SyncStatus.SUCCESS_WAITING);
      gfNetStatus$.next(NetworkStatus.HEALTH);
    } else {
      gfSyncStatus$.next(SyncStatus.FAILED_WARNING);
      gfNetStatus$.next(NetworkStatus.CONNECTION_ERROR);
      throw Error(`Failed on patched event: ${todo.content}`);
    }
  }

  /**
     * Returns a patch object for a completed event in Google Calendar.
     * @param todo The Todo object to patch.
     * @returns {calendar_v3.Schema$Event} The patch object.
     */
  static getEventDonePatch(todo: Todo): calendar_v3.Schema$Event {
    if (!todo.eventStatus) {
      todo.eventStatus = 'x';
    }
    if (['!', '?', '>', '-', ' '].indexOf(todo.eventStatus) < 0) {
      todo.eventStatus = 'x';
    }

    const eventDescUpdate = todo.serializeDescription();
    switch (todo.eventStatus) {
      case '-':
        return {
          "summary": `🚫 ${todo.content}`,
          "description": eventDescUpdate,
        } as calendar_v3.Schema$Event;
      case '!':
        return {
          "summary": `❗️ ${todo.content}`,
          "description": eventDescUpdate,
        } as calendar_v3.Schema$Event;
      case '>':
        return {
          "summary": `💤 ${todo.content}`,
          "description": eventDescUpdate,
        } as calendar_v3.Schema$Event;
      case '?':
        return {
          "summary": `❓ ${todo.content}`,
          "description": eventDescUpdate,
        } as calendar_v3.Schema$Event;
      case 'x':
      case 'X':
        return {
          "summary": `✅ ${todo.content}`,
          "description": eventDescUpdate,
        } as calendar_v3.Schema$Event;
    }
    return {
      "summary": `✅ ${todo.content}`,
      "description": eventDescUpdate,
    } as calendar_v3.Schema$Event;
  }

  /**
   * Checks if the client is authorized to call APIs.
   * @returns {Promise<boolean>} Whether the client is authorized.
   */
  async isReady(): Promise<boolean> {
    if (this.isTokenRefreshing) {
      return false;
    }

    const client = await this.loadSavedCredentialsIfExist();
    if (!client) {
      return false;
    }
    
    return true;
  }

  /**
   * Reads previously authorized credentials from the save file.
   * @returns {Promise<OAuth2Client|null>} The authorized client or null if not found.
   */
  async loadSavedCredentialsIfExist() {
    try {
      const content = await this.vault.adapter.read(this.TOKEN_PATH);
      const credentials = JSON.parse(content);
      return google.auth.fromJSON(credentials);
    } catch (err) {
      return null;
    }
  }

  /**
   * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
   * @param {OAuth2Client} client The client to serialize.
   * @returns {Promise<void>}
   */
  async saveCredentials(client: OAuth2Client) {
    const content = await this.vault.adapter.read(this.CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;

    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await this.vault.adapter.write(this.TOKEN_PATH, payload);
  }

  /**
   * Load or request authorization to call APIs.
   * @returns {Promise<OAuth2Client>} The authorized client.
   */
  public async authorize(): Promise<OAuth2Client> {
    let client: OAuth2Client;
    if (this.isTokenValid) {
      client = await this.loadSavedCredentialsIfExist() as OAuth2Client;
      if (client) {
        return client;
      }
    }

    this.isTokenRefreshing = true;
    const fs_adapter = this.vault.adapter as FileSystemAdapter;
    const KEY_FILE = fs_adapter.getFullPath(this.CREDENTIALS_PATH);
    client = await authenticate({
      scopes: this.SCOPES,
      keyfilePath: KEY_FILE,
    }).catch(err => { throw err; });

    if (client.credentials) {
      await this.saveCredentials(client);
    }
    this.isTokenValid = true;
    this.isTokenRefreshing = false;
    return client;
  }

}