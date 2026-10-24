import { GraphQLError } from 'graphql'
import { hamburgFoodService } from '@/utils/food-refresh'

const locations = ['BerlinerTorMensa', 'BergedorfMensa', 'FinkenauMensa']
export async function food(
    _: unknown,
    args: { locations: string[]; language?: string }
) {
    if (args.locations.some((location) => !locations.includes(location)))
        throw new GraphQLError('Unsupported Hamburg cafeteria')
    const snapshot = await hamburgFoodService.get()
    const language = args.language ?? 'de'
    if (!['de', 'en'].includes(language))
        throw new GraphQLError('Unsupported food language')
    if (language === 'en' && !snapshot.englishFoodData)
        throw new GraphQLError('English food source unavailable')
    const foodData =
        language === 'en' ? snapshot.englishFoodData! : snapshot.foodData
    return {
        ...snapshot,
        translationFallback:
            language === 'en' ? false : snapshot.translationFallback,
        foodData: foodData.map((day) => ({
            ...day,
            meals: day.meals.filter((meal) =>
                args.locations.includes(meal.restaurant)
            )
        })),
        errors: snapshot.available
            ? snapshot.errors
            : [{ location: 'Hamburg', message: 'Food source unavailable' }]
    }
}
