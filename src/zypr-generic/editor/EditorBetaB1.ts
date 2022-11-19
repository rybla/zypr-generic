import grammar from "../language/LanguageAlpha";
import backend from "../backend/BackendB";
import frontend from "../frontend/Frontend1";

export default function editor() {
    return frontend({ backend: backend({ grammar: grammar() }) })
}