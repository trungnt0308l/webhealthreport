import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import ScanProgress from './pages/ScanProgress.jsx';
import Report from './pages/Report.jsx';
import Monitor from './pages/Monitor.jsx';
import Register from './pages/Register.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/scan/:id" element={<ScanProgress />} />
        <Route path="/report/:id" element={<Report />} />
        <Route path="/monitor" element={<Monitor />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    </BrowserRouter>
  );
}
