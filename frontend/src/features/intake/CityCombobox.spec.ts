import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CityCombobox from './CityCombobox.vue'
import type { PlaceChoice } from './draft'
import { placeLabel, searchPlaces, type Place } from './placesApi'

const kazan: Place = { id: 'ru-kzn', name: 'Казань', region: 'Республика Татарстан', country: 'Россия', latitude: 55.79, longitude: 49.12, timezone: 'Europe/Moscow' }
const kaliningrad: Place = { id: 'ru-kgd', name: 'Калининград', country: 'Россия', latitude: 54.71, longitude: 20.51, timezone: 'Europe/Kaliningrad' }

type Search = (query: string, signal: AbortSignal) => Promise<Place[]>

function setup(search: Search) {
  const state: { query: string; selected: PlaceChoice | null } = { query: '', selected: null }
  const wrapper = mount(CityCombobox, {
    attachTo: document.body,
    props: {
      id: 'city',
      describedBy: undefined,
      invalid: false,
      search,
      query: state.query,
      selected: state.selected,
      'onUpdate:query': (value: string) => {
        state.query = value
        void wrapper.setProps({ query: value })
      },
      'onUpdate:selected': (value: PlaceChoice | null) => {
        state.selected = value
        void wrapper.setProps({ selected: value })
      },
    },
  })
  const input = wrapper.get('input')
  return { wrapper, input, state }
}

describe('CityCombobox', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom has no layout, so no scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('debounces typing into one search for the latest text', async () => {
    const search = vi.fn<Search>().mockResolvedValue([kazan])
    const { input } = setup(search)

    await input.setValue('Ка')
    await vi.advanceTimersByTimeAsync(100)
    await input.setValue('Каз')
    await vi.advanceTimersByTimeAsync(249)
    expect(search).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search.mock.calls[0]?.[0]).toBe('Каз')
  })

  it('does not search below two characters', async () => {
    const search = vi.fn<Search>().mockResolvedValue([kazan])
    const { input } = setup(search)
    await input.setValue('К')
    await vi.advanceTimersByTimeAsync(500)
    expect(search).not.toHaveBeenCalled()
    expect(input.attributes('aria-expanded')).toBe('false')
  })

  it('aborts the older search and drops its late answer', async () => {
    const answers: { resolve: (places: Place[]) => void; signal: AbortSignal }[] = []
    const search = vi.fn<Search>((_query, signal) => new Promise((resolve) => answers.push({ resolve, signal })))
    const { wrapper, input } = setup(search)

    await input.setValue('Ка')
    await vi.advanceTimersByTimeAsync(250)
    await input.setValue('Кали')
    await vi.advanceTimersByTimeAsync(250)
    expect(answers).toHaveLength(2)
    expect(answers[0]?.signal.aborted).toBe(true)

    answers[1]?.resolve([kaliningrad])
    answers[0]?.resolve([kazan])
    await flushPromises()
    const options = wrapper.findAll('[role="option"]')
    expect(options.map((o) => o.find('.city__name').text())).toEqual(['Калининград'])
  })

  it('makes the first match active and exposes it through aria-activedescendant', async () => {
    const { wrapper, input } = setup(vi.fn<Search>().mockResolvedValue([kazan, kaliningrad]))
    await input.setValue('Ка')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()

    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(input.attributes('aria-controls')).toBe('city-listbox')
    expect(input.attributes('aria-activedescendant')).toBe('city-option-0')
    expect(wrapper.get('#city-option-0').attributes('aria-selected')).toBe('true')

    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBe('city-option-1')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBe('city-option-0')
    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(input.attributes('aria-activedescendant')).toBe('city-option-1')
  })

  it('Enter picks the active city and is not passed on to the form', async () => {
    const { input, state } = setup(vi.fn<Search>().mockResolvedValue([kazan]))
    await input.setValue('Каз')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()

    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    input.element.dispatchEvent(event)
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(state.selected).toEqual({ id: 'ru-kzn', name: 'Казань', region: 'Республика Татарстан', country: 'Россия' })
    expect(state.query).toBe('Казань')
    expect(input.attributes('aria-expanded')).toBe('false')
  })

  it('Enter waits while the list does not match the text yet', async () => {
    const { input, state } = setup(vi.fn<Search>().mockResolvedValue([kazan]))
    await input.setValue('Каз')
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    input.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(state.selected).toBeNull()
  })

  it('Escape closes the list', async () => {
    const { input } = setup(vi.fn<Search>().mockResolvedValue([kazan]))
    await input.setValue('Каз')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    await input.trigger('keydown', { key: 'Escape' })
    expect(input.attributes('aria-expanded')).toBe('false')
    expect(input.attributes('aria-activedescendant')).toBeUndefined()
  })

  it('editing the text drops the chosen city', async () => {
    const { input, state } = setup(vi.fn<Search>().mockResolvedValue([kazan]))
    await input.setValue('Каз')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    await input.trigger('keydown', { key: 'Enter' })
    expect(state.selected).not.toBeNull()

    await input.setValue('Казан')
    expect(state.selected).toBeNull()
  })

  it('says «Ищем…» only after 300 ms of waiting', async () => {
    const search = vi.fn<Search>(() => new Promise(() => undefined))
    const { wrapper, input } = setup(search)
    await input.setValue('Каз')
    await vi.advanceTimersByTimeAsync(250 + 299)
    expect(wrapper.find('.city__progress').classes()).not.toContain('is-on')
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.find('.city__progress').classes()).toContain('is-on')
    expect(wrapper.get('[role="status"]').text()).toBe('Ищем…')
  })

  it('shows the empty state and the failure with a retry', async () => {
    const search = vi.fn<Search>().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce([kazan])
    const { wrapper, input } = setup(search)

    await input.setValue('Зз')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    expect(wrapper.text()).toContain('Ничего не нашли.')

    await input.setValue('Каз')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    expect(wrapper.text()).toContain('Не удалось загрузить список.')

    await wrapper.get('.city__retry').trigger('click')
    await flushPromises()
    expect(search).toHaveBeenCalledTimes(3)
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
  })
})

describe('places API', () => {
  it('finds cities by any word prefix through the typed client', async () => {
    const places = await searchPlaces('каз', new AbortController().signal)
    expect(places.map((p) => p.name)).toContain('Казань')
    for (const place of places) {
      expect(place).toEqual(expect.objectContaining({ id: expect.any(String), timezone: expect.any(String), latitude: expect.any(Number) }))
    }
  })

  it('labels a place with its region and country', () => {
    expect(placeLabel(kazan)).toBe('Казань · Республика Татарстан · Россия')
    expect(placeLabel(kaliningrad)).toBe('Калининград · Россия')
  })
})
