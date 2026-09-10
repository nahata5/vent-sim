import { render } from 'preact';
import { App } from './app/App';

const root = document.getElementById('app');
if (!root) throw new Error('#app root missing');
render(<App />, root);
