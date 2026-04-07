#include "pcsc_reader.h"
#include "pcsc_errors.h"
#include "pcsc_debug.h"
#include <cstring>
#include <functional>
#include <memory>

Napi::FunctionReference PCSCReader::constructor;

// Generic async worker for PC/SC operations.
// Execute runs on a background thread; resolve runs on the JS thread on success.
class PCSCAsyncWorker : public Napi::AsyncWorker {
public:
    PCSCAsyncWorker(Napi::Env env,
                    std::function<LONG()> execute,
                    std::function<Napi::Value(Napi::Env)> resolve,
                    Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env),
          execute_(std::move(execute)),
          resolve_(std::move(resolve)),
          result_(SCARD_S_SUCCESS),
          deferred_(deferred) {}

    void Execute() override { result_ = execute_(); }

    void OnOK() override {
        Napi::Env env = Env();
        if (result_ == SCARD_S_SUCCESS) {
            deferred_.Resolve(resolve_(env));
        } else {
            deferred_.Reject(CreatePCSCError(env, result_).Value());
        }
    }

    void OnError(const Napi::Error& error) override {
        deferred_.Reject(error.Value());
    }

private:
    std::function<LONG()> execute_;
    std::function<Napi::Value(Napi::Env)> resolve_;
    LONG result_;
    Napi::Promise::Deferred deferred_;
};

static Napi::Value RunAsync(Napi::Env env,
                            std::function<LONG()> execute,
                            std::function<Napi::Value(Napi::Env)> resolve) {
    auto deferred = Napi::Promise::Deferred::New(env);
    auto* worker = new PCSCAsyncWorker(env, std::move(execute), std::move(resolve), deferred);
    worker->Queue();
    return deferred.Promise();
}

Napi::Object PCSCReader::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "PCSCReader", {
        InstanceAccessor("name", &PCSCReader::GetName, nullptr),
        InstanceAccessor("protocol", &PCSCReader::GetProtocolValue, nullptr),
        InstanceAccessor("connected", &PCSCReader::GetConnectedValue, nullptr),
        InstanceAccessor("atr", &PCSCReader::GetAtr, nullptr),
        InstanceMethod("connect", &PCSCReader::Connect),
        InstanceMethod("transmit", &PCSCReader::Transmit),
        InstanceMethod("control", &PCSCReader::Control),
        InstanceMethod("disconnect", &PCSCReader::Disconnect),
        InstanceMethod("reconnect", &PCSCReader::Reconnect),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();

    exports.Set("PCSCReader", func);
    return exports;
}

Napi::Object PCSCReader::NewInstance(Napi::Env env, SCARDCONTEXT context,
                                    const std::string& readerName) {
    Napi::Object obj = constructor.New({});
    PCSCReader* readerObj = Napi::ObjectWrap<PCSCReader>::Unwrap(obj);
    readerObj->context_ = context;
    readerObj->readerName_ = readerName;
    return obj;
}

PCSCReader::PCSCReader(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<PCSCReader>(info),
      context_(0),
      card_(0),
      protocol_(SCARD_PROTOCOL_UNDEFINED),
      connected_(false) {
    // Properties set via NewInstance
}

PCSCReader::~PCSCReader() {
    if (connected_ && card_ != 0) {
        SCardDisconnect(card_, SCARD_LEAVE_CARD);
        connected_ = false;
        card_ = 0;
    }
}

Napi::Value PCSCReader::GetName(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), readerName_);
}

Napi::Value PCSCReader::GetProtocolValue(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), protocol_);
}

Napi::Value PCSCReader::GetConnectedValue(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), connected_);
}

Napi::Value PCSCReader::GetAtr(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        return env.Null();
    }

    DWORD readerLen = 0;
    DWORD state = 0;
    DWORD protocol = 0;
    BYTE atr[MAX_ATR_SIZE];
    DWORD atrLen = sizeof(atr);

    LONG result = SCardStatus(card_, nullptr, &readerLen, &state, &protocol, atr, &atrLen);

    if (result != SCARD_S_SUCCESS) {
        return env.Null();
    }

    return Napi::Buffer<uint8_t>::Copy(env, atr, atrLen);
}

Napi::Value PCSCReader::Connect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (connected_) {
        Napi::Error::New(env, "Already connected").ThrowAsJavaScriptException();
        return env.Null();
    }

    DWORD shareMode = SCARD_SHARE_SHARED;
    DWORD preferredProtocols = SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1;

    if (info.Length() > 0 && info[0].IsNumber()) {
        shareMode = info[0].As<Napi::Number>().Uint32Value();
    }

    if (info.Length() > 1 && info[1].IsNumber()) {
        preferredProtocols = info[1].As<Napi::Number>().Uint32Value();
    }

    struct Result { SCARDHANDLE card; DWORD protocol; };
    auto result = std::make_shared<Result>();

    return RunAsync(env,
        [this, shareMode, preferredProtocols, result]() {
            LogPcscCall("SCardConnect", readerName_);
            return SCardConnect(context_, readerName_.c_str(),
                shareMode, preferredProtocols, &result->card, &result->protocol);
        },
        [this, result](Napi::Env env) {
            card_ = result->card;
            protocol_ = result->protocol;
            connected_ = true;
            return env.Undefined();
        });
}

Napi::Value PCSCReader::Transmit(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        Napi::Error::New(env, "Card is not connected").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected command buffer").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (!info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Expected Buffer").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::vector<uint8_t> sendBuffer;
    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    sendBuffer.assign(buffer.Data(), buffer.Data() + buffer.Length());

    size_t maxRecvLength = 0;
    if (info.Length() > 1 && info[1].IsNumber()) {
        maxRecvLength = info[1].As<Napi::Number>().Uint32Value();
    }

    struct Result { std::vector<uint8_t> send, recv; DWORD len; };
    auto result = std::make_shared<Result>();
    result->send = std::move(sendBuffer);
    size_t bufferSize = maxRecvLength == 0 ? 258 : std::min(maxRecvLength, static_cast<size_t>(262144));
    result->recv.resize(bufferSize);

    return RunAsync(env,
        [card = card_, protocol = protocol_, result, name = readerName_]() {
            LogPcscCall("SCardTransmit", name);
            const SCARD_IO_REQUEST* pci = (protocol == SCARD_PROTOCOL_T0) ? SCARD_PCI_T0 :
                                          (protocol == SCARD_PROTOCOL_T1) ? SCARD_PCI_T1 : SCARD_PCI_RAW;
            result->len = static_cast<DWORD>(result->recv.size());
            return SCardTransmit(card, pci, result->send.data(),
                static_cast<DWORD>(result->send.size()), nullptr, result->recv.data(), &result->len);
        },
        [result](Napi::Env env) {
            return Napi::Buffer<uint8_t>::Copy(env, result->recv.data(), result->len);
        });
}

Napi::Value PCSCReader::Control(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        Napi::Error::New(env, "Card is not connected").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected control code").ThrowAsJavaScriptException();
        return env.Null();
    }

    DWORD controlCode = info[0].As<Napi::Number>().Uint32Value();

    std::vector<uint8_t> sendBuffer;
    if (info.Length() > 1) {
        if (info[1].IsBuffer()) {
            Napi::Buffer<uint8_t> buffer = info[1].As<Napi::Buffer<uint8_t>>();
            sendBuffer.assign(buffer.Data(), buffer.Data() + buffer.Length());
        } else if (info[1].IsArray()) {
            Napi::Array arr = info[1].As<Napi::Array>();
            sendBuffer.reserve(arr.Length());
            for (uint32_t i = 0; i < arr.Length(); i++) {
                sendBuffer.push_back(static_cast<uint8_t>(arr.Get(i).As<Napi::Number>().Uint32Value()));
            }
        }
    }

    struct Result { std::vector<uint8_t> send, recv; DWORD len; };
    auto result = std::make_shared<Result>();
    result->send = std::move(sendBuffer);
    result->recv.resize(256);

    return RunAsync(env,
        [card = card_, controlCode, result, name = readerName_]() {
            LogPcscCall("SCardControl", name);
            return SCardControl(card, controlCode,
                result->send.empty() ? nullptr : result->send.data(),
                static_cast<DWORD>(result->send.size()),
                result->recv.data(), static_cast<DWORD>(result->recv.size()), &result->len);
        },
        [result](Napi::Env env) {
            return Napi::Buffer<uint8_t>::Copy(env, result->recv.data(), result->len);
        });
}

Napi::Value PCSCReader::Disconnect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        return env.Undefined();
    }

    DWORD disposition = SCARD_LEAVE_CARD;
    if (info.Length() > 0 && info[0].IsNumber()) {
        disposition = info[0].As<Napi::Number>().Uint32Value();
    }

    LogPcscCall("SCardDisconnect", readerName_);
    LONG result = SCardDisconnect(card_, disposition);
    connected_ = false;
    card_ = 0;

    if (result != SCARD_S_SUCCESS) {
        ThrowPCSCError(env, result);
    }

    return env.Undefined();
}

Napi::Value PCSCReader::Reconnect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!connected_) {
        Napi::Error::New(env, "Card is not connected").ThrowAsJavaScriptException();
        return env.Null();
    }

    DWORD shareMode = SCARD_SHARE_SHARED;
    DWORD preferredProtocols = SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1;
    DWORD initialization = SCARD_LEAVE_CARD;

    if (info.Length() > 0 && info[0].IsNumber()) {
        shareMode = info[0].As<Napi::Number>().Uint32Value();
    }
    if (info.Length() > 1 && info[1].IsNumber()) {
        preferredProtocols = info[1].As<Napi::Number>().Uint32Value();
    }
    if (info.Length() > 2 && info[2].IsNumber()) {
        initialization = info[2].As<Napi::Number>().Uint32Value();
    }

    struct Result { DWORD protocol; };
    auto result = std::make_shared<Result>();

    return RunAsync(env,
        [card = card_, shareMode, preferredProtocols, initialization, result, name = readerName_]() {
            LogPcscCall("SCardReconnect", name);
            return SCardReconnect(card, shareMode, preferredProtocols,
                initialization, &result->protocol);
        },
        [this, result](Napi::Env env) {
            protocol_ = result->protocol;
            return env.Undefined();
        });
}
