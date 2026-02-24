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

export const getBaseRoleLabel = (role: string | null | undefined): string | null => {
    if (!role) return null;
    const key = `entities.role_${role}`;
    const translated = i18n.t(key);
    return translated !== key ? translated : role;
};

const RELATIONSHIP_KEY_MAP: Record<string, string> = {
    KINSHIP: 'rel_kinship',
    ALLY: 'rel_ally',
    ENEMY: 'rel_enemy',
    FRIEND: 'rel_friend',
    MENTOR: 'rel_mentor',
    STUDENT: 'rel_student',
    ROMANCE: 'rel_romance',
    RIVAL: 'rel_rival',
};

export const getRelationshipLabel = (type: string): string => {
    const key = RELATIONSHIP_KEY_MAP[type];
    if (key) {
        const translated = i18n.t(`entities.${key}`);
        if (translated !== `entities.${key}`) return translated;
    }
    return type;
};

export const relationshipTypeLabels: Record<string, string> = new Proxy(
    {} as Record<string, string>,
    {
        get(_target, prop: string) {
            return getRelationshipLabel(prop);
        },
    }
);


export const baseRoleLabels: Record<string, string> = new Proxy(
    {} as Record<string, string>,
    {
        get(_target, prop: string) {
            return getBaseRoleLabel(prop) || prop;
        },
    }
);
