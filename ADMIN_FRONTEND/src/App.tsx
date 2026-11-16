import { Route, Routes } from "react-router-dom";
import { NotFoundPage, PublicOnlyRoute, RequireAdmin, UnauthorizedPage } from "./auth/RouteGuards";
import LoginPage from "./pages/LoginPage";
import AdminPlaceholder from "./pages/AdminPlaceholder";

export default function App() {
  return <Routes>
    <Route element={<PublicOnlyRoute />}><Route path="/" element={<LoginPage />} /><Route path="/login" element={<LoginPage />} /></Route>
    <Route element={<RequireAdmin />}><Route path="/admin" element={<AdminPlaceholder />} /></Route>
    <Route path="/unauthorized" element={<UnauthorizedPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
