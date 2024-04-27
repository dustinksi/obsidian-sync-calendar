import { isSortingOption, sortingOptions } from "./Query";
import type { Query } from "./Query";
import YAML from "yaml";
import * as chrono from "chrono-node"
/**
 * Custom error class for parsing errors
 */
export class ParsingError extends Error {
  inner: Error | undefined;

  constructor(msg: string, inner: Error | undefined = undefined) {
    super(msg);
    this.inner = inner;
  }

  public toString(): string {
    if (this.inner) {
      return `${this.message}: '${this.inner}'`;
    }

    return super.toString();
  }
}

/**
 * Parses a raw string into a Query object
 * @param raw - the raw string to parse
 * @returns the parsed Query object
 * @throws ParsingError if the raw string cannot be parsed
 */
export function parseQuery(raw: string): Query {
  let obj: any;

  try {
    obj = YAML.parse(raw);
  } catch (e) {
    throw e;
  }

  return parseObject(obj);
}

/**
 * Parses a generic object into a Query object
 * @param query - the object to parse
 * @returns the parsed Query object
 * @throws ParsingError if the object is not a valid Query object
 */
function parseObject(query: any): Query {
  if (query.hasOwnProperty("name") && typeof query.name !== "string") {
    throw new ParsingError("'name' field must be a string");
  }

  if (query.hasOwnProperty("filter") && typeof query.filter !== "string") {
    throw new ParsingError("'filter' field must be a string");
  }

  if (query.hasOwnProperty("timeMin")) {
    if (typeof query.timeMin !== "string") {
      throw new ParsingError("'timeMin' field must be a string");
    }
    console.log(chrono.parseDate(query.timeMin))
    if (chrono.parseDate(query.timeMin) != null) { //allows for natural language and relative dates to work for these fields
      query.timeMin = window.moment(chrono.parseDate(query.timeMin))
    }
    else if (!window.moment(query.timeMin).isValid()) {
      throw new ParsingError("'timeMin' field must be a valid moment string");
    }
  }

  if (query.hasOwnProperty("timeMax")) {
    if (typeof query.timeMax !== "string") {
      throw new ParsingError("'timeMax' field must be a string");
    }
    if (chrono.parseDate(query.timeMax) != null) { //allows for natural language and relative dates to work for these fields
      query.timeMax = window.moment(chrono.parseDate(query.timeMax))
    }
    else if (!window.moment(query.timeMax).isValid()) {
      throw new ParsingError("'timeMax' field must be a valid moment string");
    }
  }

  if (query.hasOwnProperty("maxEvents") && typeof query.maxEvents !== "number") {
    throw new ParsingError("'maxEvents' field must be a number");
  }

  if (query.hasOwnProperty("group") && typeof query.group != "boolean") {
    throw new ParsingError("'group' field must be a boolean.");
  }

  if (query.hasOwnProperty("sorting")) {
    if (!Array.isArray(query.sorting)) {
      throw new ParsingError(
        `'sorting' field must be an array of strings within the set [${formatSortingOpts()}].`
      );
    }

    const sorting = query.sorting as any[];

    for (const element of sorting) {
      if (!(typeof element == "string") || !isSortingOption(element)) {
        throw new ParsingError(
          `'sorting' field must be an array of strings within the set [${formatSortingOpts()}].`
        );
      }
    }
  }

  return query as Query;
}

/**
 * Formats the sorting options as a string
 * @returns the formatted string of sorting options
 */
function formatSortingOpts(): string {
  return sortingOptions.map((e) => `'${e}'`).join(", ");
}
