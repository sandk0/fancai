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

export const baseRoleLabels: Record<string, string> = {
    protagonist: 'Главный герой',
    antagonist: 'Антагонист',
    supporting: 'Значимый персонаж',
    episodic: 'Эпизодический',
};

export const relationshipTypeLabels: Record<string, string> = {
    KINSHIP: 'Родство',
    ALLY: 'Союзник',
    ENEMY: 'Враг',
    FRIEND: 'Друг',
    MENTOR: 'Наставник',
    STUDENT: 'Ученик',
    ROMANCE: 'Любовь',
    RIVAL: 'Соперник',
};

export const getBaseRoleLabel = (role: string | null | undefined): string | null => {
    if (!role) return null;
    return baseRoleLabels[role] || role;
};

export const getRelationshipLabel = (type: string): string => {
    return relationshipTypeLabels[type] || type;
};
