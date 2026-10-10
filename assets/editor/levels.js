/**
 * Alto de cada nivel: lo elige el proyecto (levels[i].courses, en hiladas de 25 cm; sin dato, 12 = 3,00 m). El piso de un
 * nivel y el techo arrancan donde termina el de abajo.
 */
export const levelHeight = (project, li) => (project?.levels?.[li]?.courses ?? 12) * 25;

/** Cota (cm) del piso de un nivel: la suma de los altos de los de abajo. levelZ(p, topLevel + 1) es donde apoya el techo. */
export function levelZ(project, li) {
    let z = 0;
    for (let i = 0; i < li; i++) z += levelHeight(project, i);
    return z;
}
