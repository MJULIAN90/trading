import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Aisla un panel para que, si revienta al pintar, no se lleve la pagina entera.
 *
 * POR QUE HACE FALTA. El diario son veinte paneles que piden sus datos por su
 * cuenta. Una excepcion dentro de cualquiera de ellos deja la pantalla EN
 * BLANCO -React desmonta todo el arbol- y el unico rastro queda en la consola
 * del navegador, que no se mira. Paso de verdad: la pestaña Disciplina se
 * quedaba vacia porque un panel pedia una URL mal formada, recibia un 404 y
 * luego hacia `.map` sobre algo que no era una lista.
 *
 * Y no es un caso raro, es un caso DOCUMENTADO: el README avisa de que
 * `pnpm run build` solo compila el front, asi que es facil acabar con una
 * pantalla nueva hablando con un servidor viejo que contesta con otra forma.
 * Eso, sin esto, es una pagina en blanco.
 *
 * Con el limite, el panel que falla enseña su error y los demas siguen vivos.
 *
 * Tiene que ser una CLASE: `componentDidCatch` no existe como hook, y en React
 * 19 sigue sin existir. No es codigo antiguo por descuido.
 */

interface Props {
  children: ReactNode;
  /** Que panel es, para que el aviso diga cual de los veinte fallo. */
  nombre?: string;
}

interface State {
  error: Error | null;
}

export class Boundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // A la consola tambien, con el arbol de componentes: el mensaje de
    // pantalla es para ti, esto es para arreglarlo.
    console.error(`[panel ${this.props.nombre ?? 'sin nombre'}]`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="error">
        <b>Este panel{this.props.nombre ? ` (${this.props.nombre})` : ''} ha fallado.</b>{' '}
        {error.message}
        <div className="note" style={{ marginTop: 6 }}>
          El resto de la pagina sigue funcionando. Si acabas de recompilar, reinicia el
          servidor: <code>pnpm run build</code> solo compila la interfaz.
        </div>
        <button className="clear" style={{ marginTop: 8 }} onClick={() => this.setState({ error: null })}>
          reintentar
        </button>
      </div>
    );
  }
}
