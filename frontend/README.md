# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.5.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Estructura de componentes

Los componentes standalone se encuentran en `src/app/componentes/`. Cada uno mantiene
su lógica, plantilla HTML y estilos SCSS en archivos separados (`nombre.component.ts`,
`nombre.component.html` y `nombre.component.scss`; la raíz usa `app-component.*`).
Los estilos compartidos del sitio permanecen en `src/styles.scss`; los servicios y la
configuración de rutas permanecen en `src/app/`.

La página de inicio está agrupada en `componentes/inicio/`; su barra de búsqueda consulta
las habitaciones disponibles y dirige a `/reservas`. Desde los resultados se inicia la
reserva en `/reservar`. Las fechas y huéspedes se mantienen en el almacenamiento de
sesión para que las rutas de resultados y reserva no expongan los criterios en la URL.
El formulario de reserva reutiliza el calendario de rango y comprueba de nuevo la
disponibilidad si cambian las fechas, huéspedes o habitación. El desglose de desayuno y
mascotas usa tarifas provisionales de 5 € por persona/noche y 10 € por estancia; el
backend calcula el importe definitivo.

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
