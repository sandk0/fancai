import i18n from '@/lib/i18n';

export const getEntityTypeLabel = (type: string): string => {
    const key = `entities.type_${type}`;
    const translated = i18n.t(key);
    return translated !== key ? translated : type;
};

export const entityTypeLabels: Record<string, string> = new Proxy(
    {} as Record<string, string>,
    {
        get(_target, prop: string) {
            return getEntityTypeLabel(prop);
        },
    }
);
