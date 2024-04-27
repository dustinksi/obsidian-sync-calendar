import { debug } from 'lib/DebugLog';

import type { calendar_v3 } from 'googleapis';

export class Todo {
  public content: null | string | undefined;

  public priority?: null | string | undefined;
  public tags?: string[] | undefined;

  public startDateTime: null | string | undefined;
  public scheduledDateTime?: null | string | undefined;
  public dueDateTime?: null | string | undefined;
  public doneDateTime?: null | string | undefined;

  public children?: Todo[] | undefined;

  public calUId?: null | string | undefined;
  public eventId?: null | string | undefined;
  public eventStatus?: null | string | undefined;
  public eventHtmlLink?: null | string | undefined;

  public path?: string | undefined;
  public blockId?: null | string | undefined;

  public updated?: null | string | undefined;

  constructor({
    content,
    priority,
    tags,
    startDateTime,
    scheduledDateTime,
    dueDateTime,
    doneDateTime,
    children,
    path,
    blockId,
    eventStatus,
    updated,
    calUId,
    eventId,
    eventHtmlLink
  }: {
    content: null | string | undefined;
    priority?: null | string | undefined;
    tags?: string[] | undefined;
    startDateTime: null | string | undefined;
    scheduledDateTime?: null | string | undefined;
    dueDateTime?: null | string | undefined;
    doneDateTime?: null | string | undefined;
    children?: Todo[] | undefined;
    path?: string | undefined;
    blockId?: null | string | undefined;
    eventStatus?: null | string | undefined;
    updated?: null | string | undefined;
    calUId?: null | string | undefined;
    eventId?: null | string | undefined;
    eventHtmlLink?: null | string | undefined;
  }) {
    this.content = content;

    this.priority = priority;
    this.tags = tags;
    this.startDateTime = startDateTime;
    this.scheduledDateTime = scheduledDateTime;
    this.dueDateTime = dueDateTime;
    this.doneDateTime = doneDateTime;

    this.children = children;

    this.path = path;
    this.blockId = blockId;
    this.eventStatus = eventStatus;

    this.calUId = calUId;
    this.eventId = eventId;
    this.eventHtmlLink = eventHtmlLink;

    this.updated = updated;
  }
/**
   * Update the current Todo object with the values from another Todo object.
   * @param todo - The Todo object to update from.
   */
  public updateFrom(todo: Todo) {
    if (todo.content) { this.content = todo.content; }
    if (todo.priority) { this.priority = todo.priority; }
    if (todo.startDateTime) { this.startDateTime = todo.startDateTime; }
    if (todo.scheduledDateTime) { this.scheduledDateTime = todo.scheduledDateTime; }
    if (todo.dueDateTime) { this.dueDateTime = todo.dueDateTime; }
    if (todo.doneDateTime) { this.doneDateTime = todo.doneDateTime; }
    if (todo.tags) { this.tags = todo.tags; }
    if (todo.children) { this.children = todo.children; }
    if (todo.path) { this.path = todo.path; }
    if (todo.calUId) { this.calUId = todo.calUId; }
    if (todo.eventId) { this.eventId = todo.eventId; }
    if (todo.eventStatus) { this.eventStatus = todo.eventStatus; }
    if (todo.eventHtmlLink) { this.eventHtmlLink = todo.eventHtmlLink; }
    if (todo.updated) { this.updated = todo.updated; }
  }

  /**
   * Serialize the Todo object's description into a string.
   * @returns The serialized description string.
   */
  public serializeDescription(): string {
    return JSON.stringify({
      eventStatus: this.eventStatus ? this.eventStatus : ' ',
      blockId: this.blockId,
      priority: this.priority,
      tags: this.tags,
      doneDateTime: this.doneDateTime,
    });
  }

  /**
   * Convert a Todo object to a Google Calendar event object.
   * @param todo - The Todo object to convert.
   * @returns The Google Calendar event object.
   * @throws Error if the Todo object is invalid.
   */
  static toGoogleEvent(todo: Todo): calendar_v3.Schema$Event {
    let todoEvent = {
      'summary': todo.content,
      'description': todo.serializeDescription(),
      'start': {},
      'end': {},
      'reminders': {
        'useDefault': false,
        'overrides': [
          { 'method': 'popup', 'minutes': 10 },
        ],
      },
    } as calendar_v3.Schema$Event;

    let isValidInterval = false;
    const regDateTime = /(\d{4}-\d{2}-\d{2}T\d+:\d+)/u;
    console.log(todo.startDateTime)
    console.log(todo.dueDateTime)
    if (todo.startDateTime?.match(regDateTime) && todo.dueDateTime?.match(regDateTime)) {
      isValidInterval = true;
    }

    let isValidEvent = false;
    if (isValidInterval) {
      todoEvent.start!.dateTime = todo.startDateTime;
      todoEvent.end!.dateTime = todo.dueDateTime;
      isValidEvent = true;
    } else {
      const regDate = /(\d{4}-\d{2}-\d{2})/u;
      if (todo.startDateTime) {
        let startDateMatch = todo.startDateTime.match(regDate);
        let endDateMatch = todo.dueDateTime?.match(regDate);
        if (startDateMatch) {
          todoEvent.start!.date = startDateMatch[1];
          todoEvent.end!.date = endDateMatch ? endDateMatch[1] : startDateMatch[1];
          isValidEvent = true;
        } else if (endDateMatch) {
          todoEvent.start!.date = endDateMatch[1];
          todoEvent.end!.date = endDateMatch[1];
        }
      }
    }
    if (isValidEvent) {
      todoEvent.start!.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      todoEvent.end!.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } else {
      throw Error(`Invalid todo->event ${todo.content}`);
    }
    return todoEvent;
  }

  /**
   * Convert a Google Calendar event object to a Todo object.
   * @param eventMeta - The Google Calendar event object to convert.
   * @returns The Todo object.
   * @throws Error if the eventMeta object is invalid.
   */
  static fromGoogleEvent(eventMeta: calendar_v3.Schema$Event): Todo {
    let content = eventMeta.summary;
    let calUId = eventMeta.iCalUID;
    let eventId = eventMeta.id;
    let eventHtmlLink = eventMeta.htmlLink;
    let eventStatus = "";
    let blockId = undefined;
    let priority = undefined;
    let doneDateTime= undefined;
    let startDateTime: string;
    let dueDateTime: string;
    let tags: string[] = [];
    let updated: string | undefined = undefined;

    if (eventMeta.description !== null && eventMeta.description !== undefined) {
      eventMeta.description = eventMeta.description.replace(/<\/?span>/g, '');
      try {
        blockId = JSON.parse(eventMeta.description).blockId;
      } catch (e) { debug(`JSON parse error on ${eventMeta.description}: ${e}`); }
      try {
        priority = JSON.parse(eventMeta.description).priority;
      } catch (e) { debug(`JSON parse error on ${eventMeta.description}: ${e}`); }
      try {
        eventStatus = JSON.parse(eventMeta.description).eventStatus;
      } catch (e) { debug(`JSON parse error on ${eventMeta.description}: ${e}`); }
      try {
        tags = JSON.parse(eventMeta.description).tags;
      } catch (e) { debug(`JSON parse error on ${eventMeta.description}: ${e}`); }
      try {
        doneDateTime = JSON.parse(eventMeta.description).doneDateTime;
      } catch (e) { debug(`JSON parse error on ${eventMeta.description}: ${e}`); }
    }

    if (!eventMeta.start || !eventMeta.end) {
      throw Error("Invalid eventMeta, start/end not exist!");
    }

    if (eventMeta.start!.dateTime === null || eventMeta.start!.dateTime === undefined) {
      startDateTime = window.moment(eventMeta.start!.date).format('YYYY-MM-DD');
    } else {
      startDateTime = window.moment(eventMeta.start!.dateTime).format('YYYY-MM-DD[T]HH:mm:ssZ');
    }

    if (eventMeta.end!.dateTime === null || eventMeta.end!.dateTime === undefined) {
      dueDateTime = window.moment(eventMeta.end!.date).format('YYYY-MM-DD');
    } else {
      dueDateTime = window.moment(eventMeta.end!.dateTime).format('YYYY-MM-DD[T]HH:mm:ssZ');
    }

    if (eventMeta.updated) {
      updated = window.moment(eventMeta.updated).format('YYYY-MM-DD[T]HH:mm:ssZ');
    }

    return new Todo({
      content,
      priority,
      blockId,
      startDateTime,
      dueDateTime,
      doneDateTime,
      calUId,
      eventId,
      eventStatus,
      eventHtmlLink,
      updated,
      tags
    });
  }

  static isDatetime(datatimeString: string): boolean {
    const regDateTime = /(\d{4}-\d{2}-\d{2}T)/u;
    return datatimeString.match(regDateTime) !== null;
  }

  static momentString(momentString: string, emoji: '🛫' | '⌛' | '🗓'): string {
    if (Todo.isDatetime(momentString)) {
      return `${emoji} ${window.moment(momentString).format("YYYY-MM-DD[@]HH:mm")}`;
    }
    return `${emoji} ${momentString}`;
  }

  public isOverdue(overdueRefer?: moment.Moment): boolean {
    let referMoment = overdueRefer ? overdueRefer : window.moment();

    if (this.dueDateTime) {
      if (Todo.isDatetime(this.dueDateTime)) {
        return referMoment.isAfter(this.dueDateTime);
      } else {
        return referMoment.startOf('day').isAfter(this.dueDateTime);
      }
    }
    return false;
  }
}