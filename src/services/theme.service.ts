import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import {
    DEFAULT_THEME,
    restaurantThemes,
} from "../db/schemas/restaurantThemeSchema";
import { tables } from "../db/schemas/mesaSchema";


export async function getThemeByBusinessId(businessId: number) {
    const [theme] = await db
        .select()
        .from(restaurantThemes)
        .where(eq(restaurantThemes.businessId, businessId))
        .limit(1);

    if (!theme) {
        return {
            businessId,
            ...DEFAULT_THEME,
        };
    }

    return {
        businessId: theme.businessId,
        primaryColor: theme.primaryColor,
        secondaryColor: theme.secondaryColor,
        fontFamily: theme.fontFamily,
        logoUrl: theme.logoUrl,
    };
}

export async function saveTheme(
    businessId: number,
    theme: {
        primaryColor: string;
        secondaryColor: string;
        fontFamily: string;
        logoUrl: string | null;
    },
) {
    await db
        .insert(restaurantThemes)
        .values({
            businessId,
            primaryColor: theme.primaryColor,
            secondaryColor: theme.secondaryColor,
            fontFamily: theme.fontFamily,
            logoUrl: theme.logoUrl,
        })
        .onConflictDoUpdate({
            target: restaurantThemes.businessId,
            set: {
                primaryColor: theme.primaryColor,
                secondaryColor: theme.secondaryColor,
                fontFamily: theme.fontFamily,
                logoUrl: theme.logoUrl,
                updatedAt: new Date(),
            },
        });

    return getThemeByBusinessId(businessId);
}

export async function getThemeByTableId(tableId: string) {
  const [table] = await db
    .select({
      businessId: tables.businessId,
    })
    .from(tables)
    .where(eq(tables.id, tableId))
    .limit(1);

  if (!table) {
    return null;
  }

  return getThemeByBusinessId(table.businessId);
}

export async function saveThemeLogo(
  businessId: number,
  logoUrl: string,
) {
  const currentTheme = await getThemeByBusinessId(businessId);

  return saveTheme(businessId, {
    primaryColor: currentTheme.primaryColor,
    secondaryColor: currentTheme.secondaryColor,
    fontFamily: currentTheme.fontFamily,
    logoUrl,
  });
}