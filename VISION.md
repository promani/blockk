# Visión — Blockk Studio

## 1. Problema / Dolor

Quien quiere construir una casa con bloques de hormigón celular (HCCA) —autoconstructores, pequeños constructores y
corralones que asesoran— no tiene una forma simple de pasar de «quiero 3 dormitorios» a **cuántos bloques, bloques U,
bolsas de mortero, hierro y madera** comprar. Hoy se resuelve con planillas y reglas de mano (m² de muro × bloques por
m² + un porcentaje de desperdicio), que ignoran los cortes, las trabas, los dinteles y la corona, y terminan en pedidos
de más (material inmovilizado) o de menos (obra parada esperando un flete). El sistema constructivo es modular (bloques
de 62,5 × 25 cm) y por eso se puede calcular con precisión: el problema es que nadie lo hace pieza por pieza.

## 2. Costo de no hacer nada

Pedidos con 5–10 % de sobrecompra o faltantes que cuestan fletes extra y días de obra, y consultas repetidas al
distribuidor para cada presupuesto.

## 3. Solución propuesta

La persona **dibuja su casa** en un editor 3D simple (habitaciones, muros, puertas, ventanas, entrepiso, escalera y
techo, siempre sobre la grilla del bloque) **o se la pide a una IA** respondiendo unas preguntas («2 plantas, 3
dormitorios, cocina integrada»), y ve en el momento:

- el despiece hilada por hilada, con trabas, dinteles y corona en bloque U;
- los cortes optimizados (los sobrantes se reutilizan);
- el cómputo completo: bloques y pallets por espesor, morteros, hormigón y hierro de los bloques U, madera del
  entrepiso y del techo, losas y escaleras, con un presupuesto de referencia exportable (CSV/PDF);
- una revisión constructiva que avisa lo que no se puede construir (vanos pegados a esquinas, apoyos, luces de madera).

La IA no dibuja a mano alzada: conversa, pregunta lo que falta y usa un generador determinista que siempre entrega una
casa válida, que después se ajusta en el editor.

## 4. Fuera de alcance

- Cálculo estructural (el sistema predimensiona y avisa; no reemplaza a un profesional).
- Muros curvos o no ortogonales, más de 2 plantas con muros portantes.
- Cuentas de usuario, guardado en la nube de proyectos del editor (vive en el navegador; sólo el asistente guarda sus
  diseños por navegador, sin login).
- Integración con stock/precios reales de distribuidores, flete, exportación BIM/IFC.

## 5. Cómo sabemos que funcionó

- Precisión: el cómputo de mampostería coincide con el cálculo manual (test automático) y el descarte de material de
  las plantillas es < 4 %.
- Uso: a las 4 semanas de lanzado, al menos el 50 % de las casas generadas con la IA se abren en el editor y se
  exportan (CSV/PDF) o se llevan al cómputo.
- Velocidad: la primera casa del asistente sale en menos de 1 s (formulario inicial sin modelo) y cada ajuste en una
  sola vuelta al modelo pesado.

## 6. Riesgos y preguntas abiertas

- Valores referenciales (pallets, consumos, luces de madera) que varían por fabricante: hoy son configurables sólo en
  código; ¿exponerlos por distribuidor?
- Dependencia de un proveedor de LLM (Kimi) y de su costo; hay límites por IP y por día.
- Sin login, los diseños de la IA quedan atados al navegador.
- El generador sólo arma plantas en «tira» (bloque social + pasillo + dos bandas): casas en L o patios se dibujan a mano.
