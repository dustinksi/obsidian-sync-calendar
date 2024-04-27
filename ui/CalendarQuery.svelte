<script lang="ts">
	import { onMount, onDestroy } from "svelte";

	import type SyncCalendarPlugin from "main";
	import type { Query } from "Injector/Query";
	import { Todo } from "TodoSerialization/Todo";
	import type { MainSynchronizer } from "Syncs/MainSynchronizer";

	import ErrorDisplay from "./ErrorDisplay.svelte";
	import TaskRenderer from "./TaskRenderer.svelte";
	import NoTaskDisplay from "./NoTaskDisplay.svelte";

	export let plugin: SyncCalendarPlugin;
	export let api: MainSynchronizer;
	export let query: Query;

	let fetching = false;
	let eventsList: Todo[] = [];
	let todos: Todo[] = [];

	let autoRefreshIntervalId: null | number = null;

	let error_info: null | Error = null;
	let fetchedOnce = false;
	let eventsListTitle: string;

	$: todos = filterTodos(eventsList);

	$: eventsListTitle =
		query !== undefined && query.name
			? query.name
			: "{numberTodos} todos in calendar";

	$: {
		if (!query.refreshInterval || query.refreshInterval == -1) {
			if (autoRefreshIntervalId !== null) {
				clearInterval(autoRefreshIntervalId);
			}
		} else {
			// First, if query.refreshInterval is set.. we always use that value.
			if (autoRefreshIntervalId === null) {
				autoRefreshIntervalId = window.setInterval(async () => {
					await fetchEventLists();
				}, query.refreshInterval * 1000);
			}
		}
	}

	onMount(async () => {
		await fetchEventLists();
	});

	onDestroy(() => {
		if (autoRefreshIntervalId != null) {
			clearInterval(autoRefreshIntervalId);
		}
	});

	function filterTodos(todoList: Todo[]) {
		if (query && query.timeMax) {
			return todoList.filter((todo: Todo) => {
				if (Todo.isDatetime(todo.startDateTime!)) {
					return window
						.moment(query.timeMax)
						.isAfter(window.moment(todo.startDateTime));
				} else {
					return window
						.moment(query.timeMax)
						.isAfter(window.moment(todo.startDateTime));
				}
			});
		}
		return todoList;
	}

	async function fetchEventLists() {
		const apiIsReady = await api.isReady();
		if (!apiIsReady) {
			return;
		}

		if (fetching) {
			return;
		}
		fetching = true;

		let startMoment = window.moment().startOf("day");
		startMoment.subtract(
			window.moment.duration(plugin.settings.fetchWeeksAgo, "weeks")
		);
		if (query && query.timeMin) {
			startMoment = window.moment(query.timeMin);
		}

		const maxEvents =
			query && query.maxEvents
				? query.maxEvents
				: plugin.settings.fetchMaximumEvents;

		const fetchPromise = api
			.pullTodosFromCalendar(startMoment, maxEvents)
			.then((newEventsList) => {
				eventsList = newEventsList;
				fetchedOnce = true;
			})
			.catch((err) => {
				throw err;
			});

		const timeoutPromise = new Promise((resolve, reject) => {
			setTimeout(() => {
				reject(
					new Error(
						"Timeout occurred when fetching from Google Calendar!\nCheck your connection and proxy settings, then restart Obsidian."
					)
				);
			}, 4000);
		});

		await Promise.race([fetchPromise, timeoutPromise])
			.then(() => {
				error_info = null;
			})
			.catch((err) => {
				console.error(err)
				error_info = err;
			})
			.finally(() => {
				fetching = false;
			});
	}
</script>

<div>
	{#if eventsListTitle.length > 0}
		<h4 class="todo-list-query-title">
			{eventsListTitle.replace("{numberTodos}", todos.length.toString())}
		</h4>
	{/if}
	<button
		class="todo-list-refresh-button"
		on:click={async () => {
			await fetchEventLists();
		}}
		disabled={fetching}
	>
		<svg
			class={fetching ? "todo-list-refresh-spin" : ""}
			width="20px"
			height="20px"
			viewBox="0 0 20 20"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fill-rule="evenodd"
				d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
				clip-rule="evenodd"
			/>
		</svg>
	</button>

	{#if fetchedOnce}
		{#if eventsList.length == 0}
			<NoTaskDisplay />
		{:else if todos.length != 0}
			<ul class="contains-todo-list todo-list-todo-list">
				{#each todos as todo (todo.calUId)}
					<TaskRenderer {api} {plugin} {todo} />
				{/each}
			</ul>
		{:else}
			<NoTaskDisplay />
		{/if}
	{/if}
</div>

{#if error_info !== null}
	<ErrorDisplay error={error_info} />
{/if}
