import { expect, it } from 'bun:test'
import { mergeHamburgMenus, parseHamburgMenu } from '../hamburg'

const fixture = (title: string, uid: string, price = '2,20', codes = 'Sl') =>
    `<div data-location-id="168"><h3>Mensa Bergedorf</h3><div data-timestamp="2026-10-19"><div class="menulist__categorywrapper"><h5 class="menulist__categorytitle">Pottkieker</h5><div class="menue-tile" data-uid="${uid}" data-allergens="${codes}" data-additives="2" data-symbols="38"><div class="singlemeal" data-locations="168"><h5 class="singlemeal__headline">${title}</h5><dl><dd class="dlist__item"><span class="singlemeal__info"><span class="singlemeal__info--semibold">${price} €</span> Students</span></dd></dl></div></div></div></div></div>`
it('parses source date, cafeteria, declared labels and nullable prices', () => {
    const data = parseHamburgMenu(fixture('Eintopf', '85'), 'de')
    expect(data.records[0]).toMatchObject({
        date: '2026-10-19',
        location: '168',
        sourceId: '85',
        title: 'Eintopf',
        allergens: ['Sl'],
        additives: ['2'],
        symbols: ['38'],
        prices: { student: 2.2, employee: null, guest: null }
    })
})
it('rejects changed markup rather than silently replacing a valid menu', () => {
    expect(() =>
        parseHamburgMenu('<html>Service unavailable</html>', 'de')
    ).toThrow()
})
it('joins only explicitly verified source identifier pairs', () => {
    const result = mergeHamburgMenus(
        parseHamburgMenu(fixture('Eintopf', '85'), 'de'),
        parseHamburgMenu(fixture('Stew', '597'), 'en'),
        { '168:2026-10-19:85': '597' }
    )
    expect(result.foodData[0].meals[0].name).toEqual({
        de: 'Eintopf',
        en: 'Stew'
    })
    expect(result.foodData[0].meals[0].prices.guest).toBeNull()
})
it('falls back when two different dishes share a structural signature', () => {
    const de = parseHamburgMenu(fixture('A', '1') + fixture('B', '2'), 'de')
    const en = parseHamburgMenu(fixture('X', '3') + fixture('Y', '4'), 'en')
    const result = mergeHamburgMenus(de, en)
    expect(result.foodData[0].meals[0].name.en).toBe('A')
    expect(result.translationFallback).toBe(true)
})
it('does not infer allergen safety from a missing attribute', () => {
    const data = parseHamburgMenu(
        fixture('A', '1').replace('data-allergens="Sl"', ''),
        'de'
    )
    expect(data.records[0].allergens).toBeNull()
})
it('rejects location shells with no verified menu records', () => {
    expect(() =>
        parseHamburgMenu('<div data-location-id="168"></div>', 'de')
    ).toThrow()
    expect(() =>
        parseHamburgMenu(
            '<div data-location-id="168"><div data-timestamp="2026-10-19"></div></div>',
            'de'
        )
    ).toThrow()
})
it('does not infer translations from matching metadata', () => {
    const result = mergeHamburgMenus(
        parseHamburgMenu(fixture('Karottengemüse', '1'), 'de'),
        parseHamburgMenu(fixture('Courgette vegetables', '2'), 'en')
    )
    expect(result.foodData[0].meals[0].name.en).toBe('Karottengemüse')
    expect(result.translationFallback).toBe(true)
})
it('maps declared vegan source symbol to the upstream vegan flag', () => {
    const result = mergeHamburgMenus(
        parseHamburgMenu(fixture('A', '1'), 'de'),
        parseHamburgMenu(fixture('A', '1'), 'en')
    )
    expect(result.foodData[0].meals[0].flags).toEqual(['veg'])
})

it('serves the English source independently without inferring German/English dish identity', () => {
    const de = parseHamburgMenu(fixture('Karottengemüse', '1'), 'de')
    const en = parseHamburgMenu(fixture('Courgette vegetables', '2'), 'en')
    const english = mergeHamburgMenus({ ...de, records: [] }, en)
    expect(english.foodData[0].meals[0].name.en).toBe('Courgette vegetables')
    expect(english.foodData[0].meals[0].originalLanguage).toBe('en')
    expect(english.foodData[0].meals[0].id).toBe('hamburg:168:2026-10-19:2')
})

it('maps all published Hamburg selectable symbols and ignores unknown symbols', () => {
    const html = fixture('A', '1').replace(
        'data-symbols="38"',
        'data-symbols="31 38 17 45 999"'
    )
    const result = mergeHamburgMenus(
        parseHamburgMenu(html, 'de'),
        parseHamburgMenu(html, 'en')
    )
    expect(result.foodData[0].meals[0].flags).toEqual([
        'F',
        'V',
        'veg',
        'favorite'
    ])
})

it('maps meat and alcohol only from explicit dish icons', () => {
    const html = fixture('A', '1').replace(
        '<h5 class="singlemeal__headline">',
        '<img src="/Icons/MealIcons/Normal/beef.svg"><img src="/Icons/MealIcons/Normal/pork.svg"><img src="/Icons/MealIcons/Normal/alc.svg"><h5 class="singlemeal__headline">'
    )
    const result = mergeHamburgMenus(
        parseHamburgMenu(html, 'de'),
        parseHamburgMenu(html, 'en')
    )
    expect(result.foodData[0].meals[0].flags).toEqual(['veg', 'R', 'S', 'A'])
    expect(result.foodData[0].meals[0].flags).not.toContain('Gf')
})
