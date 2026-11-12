import { Link, Route, Routes } from 'react-router-dom';
import { Notice } from './components/layout/Notice';
import { CreateRoomPage } from './pages/CreateRoomPage';
import { HomePage } from './pages/HomePage';
import { RoomGate } from './pages/RoomGate';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/new" element={<CreateRoomPage />} />
      <Route path="/r/:code" element={<RoomGate />} />
      <Route
        path="*"
        element={
          <Notice title="Nothing on this shelf" body="That page doesn't exist.">
            <Link to="/" className="btn btn-primary">
              Back to the start
            </Link>
          </Notice>
        }
      />
    </Routes>
  );
}
