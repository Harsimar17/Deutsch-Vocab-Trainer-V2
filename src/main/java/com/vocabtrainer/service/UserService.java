package com.vocabtrainer.service;

import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.repository.FirebaseAuthClient;
import com.vocabtrainer.repository.ProgressRepository;
import org.springframework.stereotype.Service;

/**
 * Creating users: the account is saved in Firebase Auth (which keeps the
 * password), and the old shared progress can be copied into it through
 * {@link ProgressRepository}.
 */
@Service
public class UserService {

    private final FirebaseAuthClient firebase;
    private final ProgressRepository progress;

    public UserService(FirebaseAuthClient firebase, ProgressRepository progress) {
        this.firebase = firebase;
        this.progress = progress;
    }

    /** {uid, email}, plus importedLegacyProgress when that was asked for. */
    public Map<String, Object> create(String email, String password, boolean importLegacyProgress) {
        FirebaseAuthClient.FirebaseSession s = firebase.signUp(Credentials.email(email), Credentials.password(password));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("uid", s.uid());
        out.put("email", s.email());
        if (importLegacyProgress) {
            // Acts as the new user, so the security rules must let them read the old record.
            out.put("importedLegacyProgress", progress.copyLegacyProgress(new Ctx(s.uid(), s.idToken(), ZoneOffset.UTC)));
        }
        return out;
    }
}
