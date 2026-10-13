#include <napi.h>
#include <windows.h>

static napi_value GetCursorPos(napi_env env, napi_callback_info info) {
    POINT p;
    ::GetCursorPos(&p);
    
    napi_value obj, x, y;
    napi_create_object(env, &obj);
    napi_create_int32(env, p.x, &x);
    napi_create_int32(env, p.y, &y);
    napi_set_named_property(env, obj, "x", x);
    napi_set_named_property(env, obj, "y", y);
    return obj;
}

static napi_value MoveRelative(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    
    int32_t dx, dy;
    napi_get_value_int32(env, args[0], &dx);
    napi_get_value_int32(env, args[1], &dy);
    
    INPUT inp = {};
    inp.type = INPUT_MOUSE;
    inp.mi.dx = dx;
    inp.mi.dy = dy;
    inp.mi.dwFlags = MOUSEEVENTF_MOVE;
    inp.mi.time = GetTickCount();
    SendInput(1, &inp, sizeof(INPUT));
    
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
}

static napi_value MouseDown(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    
    int32_t btn = 0;
    if (argc > 0) napi_get_value_int32(env, args[0], &btn);
    
    INPUT inp = {};
    inp.type = INPUT_MOUSE;
    inp.mi.dwFlags = (btn == 0) ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_RIGHTDOWN;
    inp.mi.time = GetTickCount();
    SendInput(1, &inp, sizeof(INPUT));
    
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
}

static napi_value MouseUp(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    
    int32_t btn = 0;
    if (argc > 0) napi_get_value_int32(env, args[0], &btn);
    
    INPUT inp = {};
    inp.type = INPUT_MOUSE;
    inp.mi.dwFlags = (btn == 0) ? MOUSEEVENTF_LEFTUP : MOUSEEVENTF_RIGHTUP;
    inp.mi.time = GetTickCount();
    SendInput(1, &inp, sizeof(INPUT));
    
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_value fn;
    
    napi_create_function(env, "getCursorPos", NAPI_AUTO_LENGTH, GetCursorPos, nullptr, &fn);
    napi_set_named_property(env, exports, "getCursorPos", fn);
    
    napi_create_function(env, "moveRelative", NAPI_AUTO_LENGTH, MoveRelative, nullptr, &fn);
    napi_set_named_property(env, exports, "moveRelative", fn);
    
    napi_create_function(env, "mouseDown", NAPI_AUTO_LENGTH, MouseDown, nullptr, &fn);
    napi_set_named_property(env, exports, "mouseDown", fn);
    
    napi_create_function(env, "mouseUp", NAPI_AUTO_LENGTH, MouseUp, nullptr, &fn);
    napi_set_named_property(env, exports, "mouseUp", fn);
    
    return exports;
}

NAPI_MODULE(human_input, Init)